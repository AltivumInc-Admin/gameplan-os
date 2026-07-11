"""The SITREP generation prompt — the soul of the product.

Design intent: the output must read like a decisive operations order, not a
to-do list with headers. The rules below are the product. Tune them, don't
dilute them.
"""
import json

SYSTEM = """You are Game Plan OS, a personal AI operations officer. You write
the day's game plan for one principal: a founder running multiple ventures.
Your format is in the spirit of the military five-paragraph operations order
(Situation, Mission, Execution, Sustainment, Command & Signal), adapted for
knowledge work.

Doctrine — non-negotiable rules:
1. ONE mission. A mission is the single decisive objective for the day, stated
   in one sentence with a measurable end state. Everything else is supporting
   effort. If you cannot pick one, you have failed the principal.
2. Be decisive, not exhaustive. You are an operations officer, not a stenographer.
   Rank, cut, and say what to DROP today — explicitly, with a reason.
3. Never schedule more than 70% of available working hours. Friction is real.
   Unallocated time is the reserve; say so.
4. Respect the principal's learned preferences (provided). If you override one,
   state why in one sentence.
5. Challenge overcommitment. If the open task load is not achievable this week,
   say so plainly in Command & Signal, and name what should be renegotiated.
6. Voice: terse, concrete, calm. Sentence fragments acceptable. No filler, no
   motivational language, no exclamation points. Write like a professional who
   respects the reader's time. Plain, globally readable English — the format
   is military; the language is not. No jargon, no abbreviations the reader
   would have to look up.
7. Time blocks use the principal's local timezone and standard working hours
   unless preferences say otherwise. Deep work in the morning by default.
8. Debrief questions must be specific to TODAY's order — reference the actual
   mission and the riskiest block, never generic "how was your day".
9. command_signal.overcommitment_warning is JSON null when the load is
   achievable; otherwise one plain sentence naming what to renegotiate.

You respond with ONLY a valid JSON object matching the requested schema."""

SCHEMA = {
    "date": "YYYY-MM-DD",
    "situation": {
        "overview": "2-3 sentences: the terrain today — load, deadlines, what changed",
        "changes_since_yesterday": ["short bullet", "..."],
    },
    "mission": {
        "statement": "One sentence. One objective. Measurable end state by EOD.",
        "why_decisive": "One sentence: why THIS above all else today.",
    },
    "execution": {
        "time_blocks": [
            {"start": "HH:MM", "end": "HH:MM", "label": "block name",
             "task_ids": ["id"], "intent": "what done looks like for this block"}
        ],
        "priorities": {
            "p1": [{"task_id": "id", "title": "...", "reason": "..."}],
            "p2": [{"task_id": "id", "title": "...", "reason": "..."}],
            "p3": [{"task_id": "id", "title": "...", "reason": "..."}],
        },
        "deliberately_dropped": [
            {"task_id": "id", "title": "...", "reason": "why it does not deserve today"}
        ],
    },
    "sustainment": {
        "energy_plan": "1-2 sentences on pacing for this specific load",
        "breaks": ["HH:MM short description"],
    },
    "command_signal": {
        "decision_points": ["If X happens by HH:MM, then Y"],
        "blockers_to_escalate": ["..."],
        "say_no_to": ["specific request types to decline today"],
        "overcommitment_warning": None,
    },
    "debrief_questions": ["q1 — about the mission", "q2 — about the riskiest block", "q3 — about what was learned/slipped"],
}


def build_user_prompt(*, today: str, weekday: str, local_now: str,
                      open_tasks: list[dict], preferences: list[dict],
                      recent_debriefs: list[dict], prior_sitrep: dict | None,
                      prior_date: str | None) -> str:
    prefs_text = "\n".join(f"- {p['text']}" for p in preferences) or "- (none learned yet)"
    debrief_text = json.dumps(
        [{"date": d.get("date"), "answers": d.get("answers"),
          "analysis_summary": (d.get("analysis") or {}).get("summary")}
         for d in recent_debriefs], default=str) or "[]"
    prior_label = "MOST RECENT PLAN"
    prior_mission = "(no prior plan on record)"
    if prior_sitrep:
        prior_label = f"MOST RECENT PLAN ({prior_date})"
        prior_mission = json.dumps({
            "mission": prior_sitrep.get("body", {}).get("mission"),
            "p1": prior_sitrep.get("body", {}).get("execution", {}).get("priorities", {}).get("p1"),
        }, default=str)

    return f"""Produce today's game plan.

DATE: {today} ({weekday}) — current local time {local_now}

OPEN TASKS (id, title, notes, project, due, triage scores):
{json.dumps(open_tasks, default=str)}

LEARNED PREFERENCES (honor these; override only with stated reason):
{prefs_text}

RECENT EVENING DEBRIEFS (most recent first — use these to calibrate: what
slips, what the principal underestimates, recurring friction):
{debrief_text}

{prior_label} — its mission and P1s; address carryover explicitly in
Situation, noting the gap if it is not from yesterday:
{prior_mission}

OUTPUT: a single JSON object with exactly this schema:
{json.dumps(SCHEMA, indent=2)}"""
