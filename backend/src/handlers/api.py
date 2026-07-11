"""HTTP API router — single Lambda behind API Gateway HTTP API.

Auth: shared secret in x-sitrep-key header (personal tool; deliberately no
Cognito for the weekend — see docs/DEPLOYMENT.md for the reasoning).
CORS is owned entirely by the HTTP API's CorsConfiguration in template.yaml;
this handler deliberately sets no CORS headers.

Routes:
  POST  /dump               {text}            -> triage brain dump into tasks
  GET   /tasks?status=open                    -> list tasks
  POST  /tasks              {title,...}       -> create one task directly
  PATCH /tasks/{id}         {status,...}      -> update task
  POST  /sitrep/generate                      -> generate today's plan on demand
  GET   /sitrep/latest                        -> most recent plan
  GET   /sitrep/{date}                        -> plan for a date (YYYY-MM-DD)
  POST  /debrief            {answers:{q1,q2,q3}} -> run evening after-action loop
  GET   /health                               -> unauthenticated liveness check
"""
import decimal
import hmac
import json
import traceback

from botocore.exceptions import ClientError

from common import config, db, service

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
    if path == "/health":
        return _resp(200, {"ok": True})

    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    # Empty API_KEY means misconfiguration; deny everything rather than
    # letting empty == empty pass. Compare bytes so a non-ASCII pasted key
    # degrades to a 401, not a TypeError 500.
    supplied = headers.get("x-sitrep-key", "").encode("utf-8", "surrogatepass")
    if not config.API_KEY or not hmac.compare_digest(
            supplied, config.API_KEY.encode("utf-8")):
        return _resp(401, {"error": "missing or invalid x-sitrep-key"})

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
            if not body.get("title"):
                return _resp(400, {"error": "title is required"})
            return _resp(200, {"task": db.put_task(body)})

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

        if method == "GET" and path == "/sitrep/latest":
            item = db.latest_sitrep()
            return _resp(200, {"sitrep": item})

        if method == "GET" and path.startswith("/sitrep/"):
            return _resp(200, {"sitrep": db.get_sitrep(path.split("/")[-1])})

        if method == "POST" and path == "/debrief":
            answers = body.get("answers") or {}
            if not answers:
                return _resp(400, {"error": "answers is required"})
            return _resp(200, {"analysis": service.process_debrief(answers)})

        return _resp(404, {"error": f"no route for {method} {path}"})

    except Exception as exc:  # surface real errors during the weekend build
        traceback.print_exc()
        return _resp(500, {"error": str(exc)})
