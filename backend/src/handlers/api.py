"""HTTP API router — single Lambda behind API Gateway HTTP API.

Auth: shared secret in x-sitrep-key header (personal tool; deliberately no
Cognito for the weekend — see docs/DEPLOYMENT.md for the reasoning).
CORS is owned entirely by the HTTP API's CorsConfiguration in template.yaml;
this handler deliberately sets no CORS headers.

Routes:
  POST  /dump               {text}            -> triage brain dump into tasks
  GET   /tasks?status=open                    -> list tasks
  POST  /tasks              {title,...}       -> create one task directly
  PATCH /tasks/{id}         {status,...}      -> update task (open|done|dropped, triage, ...)
  POST  /sitrep/generate                      -> generate today's plan on demand
  POST  /sitrep/replan      {note}            -> revise the rest of today, mission pinned
  PATCH /sitrep/{date}/blocks {index,status}  -> mark a block done|skipped|null
  GET   /sitrep/latest                        -> most recent plan
  GET   /sitrep/{date}                        -> plan for a date (YYYY-MM-DD)
  GET   /preferences                          -> learned preferences, with ids
  DELETE /preferences/{id}                    -> forget one learned preference
  POST  /debrief            {answers:{q1,q2,q3}} -> evening loop; returns analysis + receipt
  GET   /agent/chat                           -> stored agent conversation (web channel)
  POST  /agent/chat         {message}|{reset} -> one agent turn; returns reply + receipt flags
  POST  /agent/telegram                       -> Telegram webhook (secret-token auth, not x-sitrep-key)
  GET   /health                               -> unauthenticated liveness check
"""
import decimal
import hmac
import json
import traceback

from botocore.exceptions import ClientError

from common import config, db, service, telegram

MAX_CHAT_CHARS = 4000

TELEGRAM_WELCOME = (
    "You are connected to Game Plan OS. Text me what you finished, what came "
    "up, or how your schedule changed, and I will update your plan - marking "
    "tasks done, adding new ones, or replanning the rest of the day. Ask "
    "\"what's my plan\" any time. Send /reset to start a fresh conversation.")


def _authorized(headers: dict) -> bool:
    """Two accepted credentials: a Cognito access token (the console after
    sign-in) or the static service key (scripts, smoke tests)."""
    bearer = headers.get("authorization", "")
    if bearer.lower().startswith("bearer "):
        # Lazy import: PyJWT lives in the dependencies layer.
        from common import auth
        if auth.verify_bearer(bearer[7:].strip()):
            return True
    # Empty API_KEY means misconfiguration; deny rather than letting
    # empty == empty pass. Compare bytes so a non-ASCII pasted key degrades
    # to a 401, not a TypeError 500.
    supplied = headers.get("x-sitrep-key", "").encode("utf-8", "surrogatepass")
    return bool(config.API_KEY) and hmac.compare_digest(
        supplied, config.API_KEY.encode("utf-8"))


def _agent_turn(channel: str, message: str) -> dict:
    # Imported lazily: strands lives in a Lambda layer attached to this
    # function only, and only agent routes pay its import cost.
    from agent import runtime
    return runtime.run_turn(channel, message)


def _telegram_webhook(headers: dict, event: dict) -> dict:
    """Telegram calls this; auth is the webhook secret token, not the API key.

    Always ACK with 200 once authenticated - Telegram retries non-200s, and a
    poison update must not become a retry storm against Bedrock.
    """
    if not (config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_WEBHOOK_SECRET):
        return _resp(404, {"error": "telegram channel not configured"})
    supplied = headers.get("x-telegram-bot-api-secret-token", "")
    if not hmac.compare_digest(
            supplied.encode("utf-8", "surrogatepass"),
            config.TELEGRAM_WEBHOOK_SECRET.encode("utf-8")):
        return _resp(401, {"error": "bad webhook secret"})
    try:
        update = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _resp(200, {"ok": True})
    parsed = telegram.parse_update(update)
    if parsed is None:
        return _resp(200, {"ok": True})
    # Single-owner allowlist. Until claimed, reply with the chat id so the
    # owner can set TELEGRAM_CHAT_ID; deny everyone else silently.
    if not config.TELEGRAM_CHAT_ID:
        print(json.dumps({"event": "telegram_unclaimed_chat",
                          "chat_id": parsed["chat_id"]}))
        telegram.send_message(parsed["chat_id"],
                              "This bot serves a single owner and is not "
                              f"claimed yet. Your chat id is {parsed['chat_id']}; "
                              "set it as TELEGRAM_CHAT_ID to claim the bot.")
        return _resp(200, {"ok": True})
    if parsed["chat_id"] != config.TELEGRAM_CHAT_ID:
        print(json.dumps({"event": "telegram_denied_chat",
                          "chat_id": parsed["chat_id"]}))
        return _resp(200, {"ok": True})
    # At-most-once: record the update id before running the agent, so a
    # Telegram retry of a slow turn cannot apply the same mutation twice.
    update_id = parsed.get("update_id")
    if isinstance(update_id, int):
        if update_id <= db.get_last_update_id():
            return _resp(200, {"ok": True, "duplicate": True})
        db.set_last_update_id(update_id)
    text = parsed["text"]
    try:
        if text.startswith("/start"):
            telegram.send_message(parsed["chat_id"], TELEGRAM_WELCOME)
        elif text.startswith("/reset"):
            db.clear_chat("telegram")
            telegram.send_message(parsed["chat_id"],
                                  "Fresh conversation. What's the situation?")
        else:
            result = _agent_turn("telegram", text)
            telegram.send_message(parsed["chat_id"], result["reply"])
    except Exception:
        traceback.print_exc()
        try:
            telegram.send_message(parsed["chat_id"],
                                  "Something went wrong handling that. "
                                  "Try again in a minute.")
        except Exception:
            traceback.print_exc()
    return _resp(200, {"ok": True})

MAX_DUMP_CHARS = 8000


class _Encoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            return float(o) if o % 1 else int(o)
        return str(o)


def _resp(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, cls=_Encoder),
    }


def handler(event, _context):
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", "")
    path = event.get("rawPath", "").rstrip("/")
    # The ANY /{proxy+} route catches preflight OPTIONS before API Gateway's
    # automatic CORS response can. Answer 200 pre-auth (preflights carry no
    # custom headers); the HTTP API's CorsConfiguration appends the
    # access-control-* headers for allowed origins.
    if method == "OPTIONS":
        return _resp(200, {})
    if path == "/health":
        return _resp(200, {"ok": True})

    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    # Telegram authenticates with its own webhook secret, not the API key.
    if method == "POST" and path == "/agent/telegram":
        try:
            return _telegram_webhook(headers, event)
        except Exception as exc:
            traceback.print_exc()
            return _resp(500, {"error": str(exc)})
    if not _authorized(headers):
        return _resp(401, {"error": "sign in required (or provide a valid x-sitrep-key)"})

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except json.JSONDecodeError:
            return _resp(400, {"error": "invalid JSON body"})
        if not isinstance(body, dict):
            return _resp(400, {"error": "body must be a JSON object"})
    qs = event.get("queryStringParameters") or {}

    try:
        # ---- routing ----
        if method == "POST" and path == "/dump":
            text = (body.get("text") or "").strip()
            if not text:
                return _resp(400, {"error": "text is required"})
            if len(text) > MAX_DUMP_CHARS:
                return _resp(400, {"error": f"dump is over {MAX_DUMP_CHARS} characters; split it into smaller dumps"})
            return _resp(200, {"created": service.triage_dump(text)})

        if method == "GET" and path == "/tasks":
            return _resp(200, {"tasks": db.list_tasks(qs.get("status"))})

        if method == "POST" and path == "/tasks":
            task = service._normalize_task(body)
            if task is None:
                return _resp(400, {"error": "title is required"})
            if not task["triage"].get("rationale"):
                task["triage"]["rationale"] = "added directly"
            return _resp(200, {"task": db.put_task(task)})

        if method == "PATCH" and path.startswith("/tasks/"):
            try:
                db.update_task(path.split("/")[-1], body)
            except ValueError as exc:
                return _resp(400, {"error": str(exc)})
            except ClientError as exc:
                if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                    return _resp(404, {"error": "unknown task id"})
                raise
            return _resp(200, {"ok": True})

        if method == "POST" and path == "/sitrep/generate":
            return _resp(200, {"sitrep": service.generate_sitrep()})

        if method == "POST" and path == "/sitrep/replan":
            try:
                return _resp(200, {"sitrep": service.replan_sitrep(body.get("note") or "")})
            except ValueError as exc:
                return _resp(409, {"error": str(exc)})

        if method == "PATCH" and path.startswith("/sitrep/") and path.endswith("/blocks"):
            date = path.split("/")[2]
            try:
                statuses = db.set_block_status(
                    date, body.get("index"), body.get("status"))
            except ValueError as exc:
                return _resp(400, {"error": str(exc)})
            return _resp(200, {"block_status": statuses})

        if method == "GET" and path == "/sitrep/latest":
            item = db.latest_sitrep()
            return _resp(200, {"sitrep": item})

        if method == "GET" and path.startswith("/sitrep/"):
            return _resp(200, {"sitrep": db.get_sitrep(path.split("/")[-1])})

        if method == "GET" and path == "/preferences":
            prefs = db.get_preferences()
            return _resp(200, {"preferences": [
                {**p, "id": db.preference_id(p.get("text", ""))} for p in prefs]})

        if method == "DELETE" and path.startswith("/preferences/"):
            if db.delete_preference(path.split("/")[-1]):
                return _resp(200, {"ok": True})
            return _resp(404, {"error": "unknown preference id"})

        if method == "GET" and path == "/agent/chat":
            return _resp(200, {"messages": db.get_chat("web")})

        if method == "POST" and path == "/agent/chat":
            if body.get("reset"):
                db.clear_chat("web")
                return _resp(200, {"ok": True, "messages": []})
            message = (body.get("message") or "").strip()
            if not message:
                return _resp(400, {"error": "message is required"})
            if len(message) > MAX_CHAT_CHARS:
                return _resp(400, {"error": f"message is over {MAX_CHAT_CHARS} characters"})
            return _resp(200, _agent_turn("web", message))

        if method == "POST" and path == "/debrief":
            answers = body.get("answers") or {}
            if not answers:
                return _resp(400, {"error": "answers is required"})
            return _resp(200, service.process_debrief(answers))

        return _resp(404, {"error": f"no route for {method} {path}"})

    except Exception as exc:  # surface real errors during the weekend build
        traceback.print_exc()
        return _resp(500, {"error": str(exc)})
