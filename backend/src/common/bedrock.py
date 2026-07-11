"""Thin wrapper around the Bedrock Converse API.

Two models, two jobs:
  - Nova Pro  -> game plan generation + debrief analysis (reasoning-heavy)
  - Nova Lite -> brain-dump triage (fast, cheap, structured extraction)

All calls request JSON output and are parsed defensively: models sometimes
wrap JSON in markdown fences; strip_json() handles that. Every call emits one
structured log line (model, token usage, stop reason, latency) so cost and
failures are visible in CloudWatch.
"""
import json
import re

import boto3

_client = boto3.client("bedrock-runtime")


class TruncatedOutput(ValueError):
    """Model hit max_tokens; retrying the same request cannot succeed."""


def converse(model_id: str, system: str, user: str,
             max_tokens: int = 3000, temperature: float = 0.4) -> str:
    """Single-turn Converse call. Returns raw model text."""
    resp = _client.converse(
        modelId=model_id,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
    )
    stop = resp.get("stopReason")
    print(json.dumps({"event": "bedrock_call", "model": model_id,
                      "usage": resp.get("usage"), "stop_reason": stop,
                      "latency_ms": resp.get("metrics", {}).get("latencyMs")}))
    if stop == "max_tokens":
        raise TruncatedOutput(f"model output truncated at max_tokens={max_tokens}")
    return resp["output"]["message"]["content"][0]["text"]


def strip_json(text: str) -> dict:
    """Extract the first JSON object from model output, tolerating md fences."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object in model output: {text[:400]}")
    return json.loads(candidate[start:end + 1])


def converse_json(model_id: str, system: str, user: str,
                  max_tokens: int = 3000, temperature: float = 0.4,
                  retries: int = 1) -> dict:
    """Converse call that must return JSON. One retry with a stern reminder."""
    text = converse(model_id, system, user, max_tokens, temperature)
    try:
        return strip_json(text)
    except (ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"event": "bedrock_parse_failure", "model": model_id,
                          "retrying": retries > 0, "error": str(exc)[:200],
                          "text_head": text[:200]}))
        if retries <= 0:
            # The full text is the evidence prompt tuning needs; keep it whole.
            print(json.dumps({"event": "bedrock_parse_failure_full",
                              "model": model_id, "text": text}))
            raise ValueError(f"Unparseable model output: {text[:400]}") from exc
        reminder = user + "\n\nREMINDER: Respond with ONLY a valid JSON object. No prose, no markdown fences."
        return converse_json(model_id, system, reminder, max_tokens, 0.2, retries - 1)
