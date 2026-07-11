"""Evening debrief analysis prompt (Nova Pro).

This is the learning loop — the thing that separates SITREP from a prompt
wrapper. Input: today's order + the principal's three answers. Output:
an honest after-action analysis plus candidate preference updates that will
shape every future SITREP.
"""
import json

SYSTEM = """You are conducting a personal after-action review. You compare the
plan (this morning's SITREP) against reality (the principal's debrief answers)
and extract durable lessons. Rules:
1. Be honest, not kind. If the mission was not accomplished, say so and name
   the proximate cause from the evidence given.
2. Distinguish one-off events (a surprise call) from patterns (three debriefs
   in a row show morning blocks slipping). Only patterns become preferences.
3. A preference is a short imperative usable by tomorrow's planner, e.g.
   "Never schedule deep work after 15:00 — three debriefs show it slips" or
   "Estimates on Elo tasks run 2x long; pad them".
4. confidence is "high" only when supported by at least two independent
   signals across debriefs. Low-confidence hunches stay out of the profile.
   Never re-propose a preference that is already in the ALREADY-LEARNED list,
   even reworded; propose only lessons not yet covered there.
5. task_updates: include a task ONLY when the answers give explicit evidence it
   was finished ("shipped the memo" -> done) or consciously abandoned ("decided
   to kill the podcast" -> dropped). Being scheduled in a time block is NOT
   evidence. Partial progress ("half a draft") is NOT done. When in doubt,
   omit the task — a wrongly closed task disappears from every future plan.
6. Write in plain, globally readable English. No military jargon.
Respond with ONLY valid JSON."""


def build_user_prompt(*, today: str, sitrep_date: str, sitrep_body: dict,
                      answers: dict, recent_debriefs: list[dict],
                      known_preferences: list[str]) -> str:
    schema = {
        "summary": "2-3 sentence honest after-action summary",
        "mission_accomplished": True,
        "what_worked": ["..."],
        "what_slipped": [{"item": "...", "proximate_cause": "..."}],
        "candidate_preferences": [
            {"text": "imperative for tomorrow's planner",
             "evidence": "which debriefs/signals support it",
             "confidence": "high|medium|low"}
        ],
        "task_updates": [{"task_id": "id", "status": "done|dropped"}],
        "tomorrow_note": "one sentence the planner should read first tomorrow",
    }
    history = json.dumps(
        [{"date": d.get("date"), "answers": d.get("answers")} for d in recent_debriefs],
        default=str)
    prefs_text = "\n".join(f"- {p}" for p in known_preferences) or "- (none yet)"
    return f"""DATE: {today}

THE PLAN (dated {sitrep_date} — note in your analysis if plan and reality
diverge in date):
{json.dumps(sitrep_body, default=str)}

PRINCIPAL'S DEBRIEF ANSWERS (the reality):
{json.dumps(answers, default=str)}

PRIOR DEBRIEFS (for pattern detection):
{history}

ALREADY-LEARNED PREFERENCES (do NOT re-propose these, even reworded):
{prefs_text}

OUTPUT: a single JSON object with exactly this schema:
{json.dumps(schema, indent=2)}"""
