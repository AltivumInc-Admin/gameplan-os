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


def _scrub_task_ids(body: dict, valid_ids: set[str]) -> None:
    """Null out model-invented task ids in place.

    The UI and the agent treat plan task_ids as addressable references into
    the task pool; a hallucinated id would wire a button to nothing (or to
    the wrong task), so unknown ids degrade to null rather than surviving.
    """
    ex = body.get("execution", {}) or {}
    for block in ex.get("time_blocks") or []:
        if isinstance(block, dict):
            ids = block.get("task_ids")
            block["task_ids"] = [i for i in ids if i in valid_ids] if isinstance(ids, list) else []
    prios = ex.get("priorities") or {}
    for tier in ("p1", "p2", "p3"):
        for entry in prios.get(tier) or []:
            if isinstance(entry, dict) and entry.get("task_id") not in valid_ids:
                entry["task_id"] = None
    for entry in ex.get("deliberately_dropped") or []:
        if isinstance(entry, dict) and entry.get("task_id") not in valid_ids:
            entry["task_id"] = None


def _carry_block_statuses(old_blocks: list, statuses: dict, cutoff_hhmm: str) -> dict:
    """Keep status marks only for blocks that ended before the replan cutoff.

    Replanning rewrites the future part of time_blocks, so indexes of
    still-to-come blocks are meaningless afterward; past blocks are copied
    through unchanged (same indexes) and keep their marks.
    """
    kept = {}
    for key, status in (statuses or {}).items():
        try:
            idx = int(key)
            block = old_blocks[idx]
        except (ValueError, TypeError, IndexError):
            continue
        if isinstance(block, dict) and str(block.get("end", "99:99")) <= cutoff_hhmm:
            kept[str(idx)] = status
    return kept


def _finalize_plan(body: dict, today: str, open_tasks: list[dict]) -> None:
    """Shared post-model boundary normalization for generate and replan."""
    _validate_plan(body)
    _scrub_task_ids(body, {t["id"] for t in open_tasks})
    # Normalize the "no warning" sentinel once, at the boundary.
    warn = body.get("command_signal", {}).get("overcommitment_warning")
    if not warn or (isinstance(warn, str) and warn.strip().lower() == "null"):
        body["command_signal"]["overcommitment_warning"] = None
    body["date"] = today


def generate_sitrep() -> dict:
    """Generate (or regenerate) today's game plan."""
    now = _local_now()
    today = now.date().isoformat()
    prior, prior_date = _prior_plan()
    open_tasks = db.list_tasks("open")

    body = bedrock.converse_json(
        config.NOVA_PRO_MODEL_ID,
        sitrep_prompt.SYSTEM,
        sitrep_prompt.build_user_prompt(
            today=today,
            weekday=now.strftime("%A"),
            local_now=now.strftime("%H:%M"),
            open_tasks=open_tasks,
            preferences=db.get_preferences(),
            recent_debriefs=db.recent_debriefs(5),
            prior_sitrep=prior,
            prior_date=prior_date,
        ),
        max_tokens=3500, temperature=0.4)
    _finalize_plan(body, today, open_tasks)
    db.put_sitrep(today, body)
    return body


def replan_sitrep(note: str = "") -> dict:
    """Revise the remainder of today: pin the mission and the past, rebuild
    what remains from the clock forward. The note is the principal reporting
    reality; it becomes the agent's main verb later."""
    now = _local_now()
    today = now.date().isoformat()
    local_now = now.strftime("%H:%M")
    current = db.get_sitrep(today)
    if current is None:
        raise ValueError("no plan for today yet; generate one before replanning")
    open_tasks = db.list_tasks("open")
    block_status = {str(k): v for k, v in (current.get("block_status") or {}).items()}

    body = bedrock.converse_json(
        config.NOVA_PRO_MODEL_ID,
        sitrep_prompt.SYSTEM,
        sitrep_prompt.build_replan_prompt(
            today=today,
            weekday=now.strftime("%A"),
            local_now=local_now,
            current_plan=current.get("body", {}),
            block_status=block_status,
            note=(note or "").strip(),
            open_tasks=open_tasks,
            preferences=db.get_preferences(),
        ),
        max_tokens=3500, temperature=0.3)
    _finalize_plan(body, today, open_tasks)

    old_blocks = (current.get("body", {}).get("execution", {}) or {}).get("time_blocks") or []
    carried = _carry_block_statuses(old_blocks, block_status, local_now)
    revision = int(current.get("revision") or 0) + 1
    db.put_sitrep(today, body, block_status=carried, revision=revision,
                  replanned_at=now.isoformat())
    print(json.dumps({"event": "replan", "date": today, "revision": revision,
                      "note_chars": len(note or ""), "carried_statuses": len(carried)}))
    result = dict(body)
    result["block_status"] = carried
    result["revision"] = revision
    return result


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
    # The receipt: which tasks the debrief actually closed, with titles, so
    # the UI can show the mutation instead of applying it silently.
    titles = {t["id"]: t.get("title", "") for t in db.list_tasks()}
    receipt = [{**u, "title": titles.get(u["task_id"], "")} for u in applied]
    return {"analysis": analysis, "applied_task_updates": receipt}


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
