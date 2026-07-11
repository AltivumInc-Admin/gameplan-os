"""Core orchestration: generate the game plan, triage dumps, process debriefs, email."""
import datetime
import json
from zoneinfo import ZoneInfo

import boto3

from common import bedrock, config, db
from prompts import debrief_prompt, sitrep_prompt, triage_prompt

_ses = boto3.client("ses")

PLAN_SECTIONS = ("situation", "mission", "execution", "sustainment", "command_signal")


def _local_now() -> datetime.datetime:
    return datetime.datetime.now(ZoneInfo(config.LOCAL_TZ))


def _clamp(value, lo, hi, default):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _normalize_task(raw) -> dict | None:
    """Whitelist and sanity-check one model-emitted task; None if unusable."""
    if not isinstance(raw, dict):
        return None
    title = raw.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    tr = raw.get("triage")
    triage_raw: dict = tr if isinstance(tr, dict) else {}
    return {
        "title": title.strip(),
        "notes": raw.get("notes") if isinstance(raw.get("notes"), str) else "",
        "project": raw.get("project") if isinstance(raw.get("project"), str) else None,
        "due": raw.get("due") if isinstance(raw.get("due"), str) else None,
        "triage": {
            "urgency": int(_clamp(triage_raw.get("urgency"), 1, 5, 3)),
            "impact": int(_clamp(triage_raw.get("impact"), 1, 5, 3)),
            "effort_hours": _clamp(triage_raw.get("effort_hours"), 0.25, 8, 1.0),
            "rationale": triage_raw.get("rationale") if isinstance(triage_raw.get("rationale"), str) else "",
        },
    }


def triage_dump(dump: str) -> list[dict]:
    """Brain dump -> discrete triaged tasks, persisted."""
    now = _local_now()
    # All tasks (not just open) so finished projects keep anchoring inference.
    known_projects = sorted({str(t["project"]) for t in db.list_tasks() if t.get("project")})
    result = bedrock.converse_json(
        config.NOVA_LITE_MODEL_ID,
        triage_prompt.SYSTEM,
        triage_prompt.build_user_prompt(
            dump, f"{now.date().isoformat()} ({now.strftime('%A')})", known_projects),
        max_tokens=2000, temperature=0.2)
    created, skipped = [], 0
    for t in result.get("tasks", []):
        task = _normalize_task(t)
        if task is None:
            skipped += 1
            continue
        created.append(db.put_task(task))
    if skipped:
        print(json.dumps({"event": "triage_skipped_malformed", "count": skipped}))
    return created


def _prior_plan() -> tuple[dict | None, str | None]:
    """Most recent plan strictly before today, with its date."""
    today = _local_now().date().isoformat()
    yesterday = (datetime.date.fromisoformat(today) - datetime.timedelta(days=1)).isoformat()
    prior = db.get_sitrep(yesterday)
    if prior is None:
        latest = db.latest_sitrep()
        if latest and latest.get("date", "") < today:
            prior = latest
    return prior, (prior or {}).get("date")


def _validate_plan(body: dict) -> None:
    missing = [k for k in PLAN_SECTIONS if not isinstance(body.get(k), dict)]
    if missing:
        raise ValueError(f"model returned a plan missing sections: {missing}")
    if not (body.get("mission", {}).get("statement") or "").strip():
        raise ValueError("model returned a plan with an empty mission statement")


def generate_sitrep() -> dict:
    """Generate (or regenerate) today's game plan."""
    now = _local_now()
    today = now.date().isoformat()
    prior, prior_date = _prior_plan()

    body = bedrock.converse_json(
        config.NOVA_PRO_MODEL_ID,
        sitrep_prompt.SYSTEM,
        sitrep_prompt.build_user_prompt(
            today=today,
            weekday=now.strftime("%A"),
            local_now=now.strftime("%H:%M"),
            open_tasks=db.list_tasks("open"),
            preferences=db.get_preferences(),
            recent_debriefs=db.recent_debriefs(5),
            prior_sitrep=prior,
            prior_date=prior_date,
        ),
        max_tokens=3500, temperature=0.4)
    _validate_plan(body)
    # Normalize the "no warning" sentinel once, at the boundary.
    warn = body.get("command_signal", {}).get("overcommitment_warning")
    if not warn or (isinstance(warn, str) and warn.strip().lower() == "null"):
        body["command_signal"]["overcommitment_warning"] = None
    body["date"] = today
    db.put_sitrep(today, body)
    return body


def process_debrief(answers: dict) -> dict:
    """Evening loop: analyze answers, update tasks, persist learned preferences."""
    today = _local_now().date().isoformat()
    sitrep = db.get_sitrep(today) or db.latest_sitrep() or {}
    sitrep_date = sitrep.get("date", "unknown")
    if sitrep_date != today:
        print(json.dumps({"event": "debrief_stale_plan", "plan_date": sitrep_date}))
    analysis = bedrock.converse_json(
        config.NOVA_PRO_MODEL_ID,
        debrief_prompt.SYSTEM,
        debrief_prompt.build_user_prompt(
            today=today,
            sitrep_date=sitrep_date,
            sitrep_body=sitrep.get("body", {}),
            answers=answers,
            recent_debriefs=db.recent_debriefs(5),
            known_preferences=[p.get("text", "") for p in db.get_preferences()],
        ),
        max_tokens=2500, temperature=0.3)

    # Persist the raw analysis first: if applying it fails, the record survives.
    db.put_debrief(today, answers, analysis)

    valid_ids = {t["id"] for t in db.list_tasks()}
    applied, skipped = [], []
    for upd in analysis.get("task_updates", []):
        task_id, status = upd.get("task_id"), upd.get("status")
        if status not in ("done", "dropped"):
            continue
        if task_id not in valid_ids:
            skipped.append(task_id)
            continue
        db.update_task(task_id, {"status": status})
        applied.append({"task_id": task_id, "status": status})

    high_conf = [
        {"text": p["text"], "source": p.get("evidence", ""), "confidence": "high"}
        for p in analysis.get("candidate_preferences", [])
        if p.get("confidence") == "high" and p.get("text")
    ]
    if high_conf:
        db.append_preferences(high_conf)

    print(json.dumps({"event": "debrief_applied", "plan_date": sitrep_date,
                      "task_updates": applied, "skipped_unknown_ids": skipped,
                      "prefs_added": [p["text"] for p in high_conf]}))
    return analysis


# ---------- email rendering ----------

def render_email_text(body: dict) -> str:
    """Plaintext rendering of the plan. Terse by design; omits empty sections."""
    ex = body.get("execution", {}) or {}
    cs = body.get("command_signal", {}) or {}
    sus = body.get("sustainment", {}) or {}
    sit = body.get("situation", {}) or {}
    lines = [
        f"GAME PLAN {body.get('date', '')}".rstrip(),
        "(in the spirit of a five-paragraph operations order)",
        "",
        "1. SITUATION",
        sit.get("overview", ""),
        *[f"  - {c}" for c in sit.get("changes_since_yesterday") or []],
        "",
        "2. MISSION",
        body.get("mission", {}).get("statement", ""),
    ]
    why = body.get("mission", {}).get("why_decisive")
    if why:
        lines.append(f"   Why: {why}")
    lines += ["", "3. EXECUTION"]
    for b in ex.get("time_blocks") or []:
        if not isinstance(b, dict):
            continue
        lines.append(f"  {b.get('start', '?')}-{b.get('end', '?')}  "
                     f"{b.get('label', '')} — {b.get('intent', '')}")
    lines.append("")
    prios = ex.get("priorities") or {}
    for tier in ("p1", "p2", "p3"):
        entries = prios.get(tier) or []
        if entries:
            lines.append(f"  {tier.upper()}: " + "; ".join(
                p.get("title", "") for p in entries if isinstance(p, dict)))
    dropped = ex.get("deliberately_dropped") or []
    if dropped:
        lines.append("  DROPPED: " + "; ".join(
            f"{d.get('title', '')} ({d.get('reason', '')})"
            for d in dropped if isinstance(d, dict)))
    lines += ["", "4. SUSTAINMENT"]
    if sus.get("energy_plan"):
        lines.append(sus["energy_plan"])
    lines += [f"  - {b}" for b in sus.get("breaks") or []]
    lines += ["", "5. COMMAND & SIGNAL"]
    lines += [f"  DECISION: {d}" for d in cs.get("decision_points") or []]
    lines += [f"  BLOCKER: {b}" for b in cs.get("blockers_to_escalate") or []]
    lines += [f"  DECLINE: {s}" for s in cs.get("say_no_to") or []]
    warning = cs.get("overcommitment_warning")
    if warning and str(warning).strip().lower() != "null":
        lines += ["", f"  !! OVERCOMMITMENT: {warning}"]
    questions = body.get("debrief_questions") or []
    if questions:
        lines += ["", "-- Evening debrief questions --",
                  *[f"  {i + 1}. {q}" for i, q in enumerate(questions)]]
    return "\n".join(lines)


def send_sitrep_email(body: dict) -> None:
    mission = " ".join((body.get("mission", {}).get("statement") or "").split())
    subject = f"Game Plan {body.get('date', '')} — {mission}"[:120]
    resp = _ses.send_email(
        Source=config.NOTIFY_EMAIL,
        Destination={"ToAddresses": [config.NOTIFY_EMAIL]},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Text": {"Data": render_email_text(body)}},
        },
    )
    print(json.dumps({"event": "sitrep_email_sent", "date": body.get("date"),
                      "subject": subject, "ses_message_id": resp.get("MessageId")}))
