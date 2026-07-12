"""One conversational turn of the Game Plan OS agent.

Stateless per invocation: history is loaded from DynamoDB, replayed into the
Agent as prior messages, and the new exchange is appended after the turn.
Only plain text is persisted - tool-use blocks are an implementation detail
of a single turn and replaying them partially would produce invalid
conversations.

Honesty enforcement (all three layers earned live, in order of escalation):
Nova Pro pattern-completes "has been dropped" from conversational context
instead of calling the tool. A per-turn reminder fixes most cases. When it
does not, the retry runs on a FRESH context, because the replayed history -
which by then contains the model's own confident claims - is exactly what
teaches it to keep lying. And when even that round claims a change without a
tool call, the reply is replaced with an honest failure; a fabricated
confirmation must never reach the user or the stored history.
"""
import datetime
import json
from zoneinfo import ZoneInfo

from strands import Agent
from strands.models import BedrockModel

from agent import tools
from agent.guards import claims_change_without_tool, clean_reply
from common import config, db
from prompts import agent_prompt

HISTORY_LIMIT = 20  # messages (10 exchanges) replayed as context

# Appended to the live message only (models weight the current turn far
# above the system prompt); the raw text is what goes to history.
TURN_REMINDER = (
    "\n\n[System check: if this asks for a change, call the matching tool "
    "now, in this turn. With no tool call, nothing changed and you must say "
    "so plainly.]")

RETRY_INSTRUCTION = (
    "\n\n[You have not made any change for this request yet. Read whatever "
    "you need with tools, execute the request with the matching tool now, "
    "then report only what the tool results confirm.]")

FAILURE_REPLY = (
    "I could not complete that reliably, so I changed nothing. "
    "Please try asking again in different words.")


def _build_agent(now: datetime.datetime, history: list[dict]) -> Agent:
    return Agent(
        model=BedrockModel(
            model_id=config.NOVA_PRO_MODEL_ID,
            temperature=0.2,
            max_tokens=900,
            streaming=False,
        ),
        system_prompt=agent_prompt.build_system(
            today=now.date().isoformat(),
            weekday=now.strftime("%A"),
            local_now=now.strftime("%H:%M"),
            tz=config.LOCAL_TZ,
        ),
        messages=[{"role": m["role"], "content": [{"text": m["text"]}]}
                  for m in history],
        tools=tools.ALL_TOOLS,
        callback_handler=None,  # no streaming printer inside Lambda
    )


def _invoke(agent: Agent, text: str) -> tuple[str, list]:
    result = agent(text)
    reply = clean_reply(str(result)) or "(no reply)"
    used = sorted(getattr(result.metrics, "tool_metrics", {}) or {})
    return reply, used


def run_turn(channel: str, message: str) -> dict:
    """Run one user message through the agent. Returns
    {reply, tools_used, mutated}."""
    now = datetime.datetime.now(ZoneInfo(config.LOCAL_TZ))
    history = db.get_chat(channel)[-HISTORY_LIMIT:]
    reply, used = _invoke(_build_agent(now, history), message + TURN_REMINDER)

    if claims_change_without_tool(reply, used):
        print(json.dumps({"event": "agent_claim_without_tool",
                          "channel": channel, "reply_head": reply[:120]}))
        reply, used = _invoke(_build_agent(now, []),  # fresh context
                              message + RETRY_INSTRUCTION)
        if claims_change_without_tool(reply, used):
            print(json.dumps({"event": "agent_claim_retry_failed",
                              "channel": channel, "reply_head": reply[:120]}))
            reply, used = FAILURE_REPLY, []

    db.append_chat(channel, message, reply)
    print(json.dumps({"event": "agent_turn", "channel": channel,
                      "tools_used": used, "history_len": len(history)}))
    return {"reply": reply, "tools_used": used,
            "mutated": bool(set(used) & tools.MUTATING_TOOLS)}
