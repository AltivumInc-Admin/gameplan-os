"""DynamoDB single-table access layer.

Table design (PK = USER#<id> for everything; SK discriminates entity type):

  PK              SK                     Entity
  --------------  ---------------------  ---------------------------------
  USER#primary    TASK#<ulid>            A task (from brain dump or manual)
  USER#primary    SITREP#<yyyy-mm-dd>    The generated daily game plan
  USER#primary    DEBRIEF#<yyyy-mm-dd>   Evening debrief answers + analysis
  USER#primary    PREF#profile           Single doc: learned preferences list

Task item shape:
  {id, title, notes, project, status: open|done|dropped,
   due: iso-date|null, created_at,
   triage: {urgency: 1-5, impact: 1-5, effort_hours, rationale}}

Preference doc shape:
  {preferences: [{text, source, learned_at, confidence}], updated_at}

Boundary contract: writes coerce floats to Decimal (_clean); reads strip the
key attributes and coerce Decimal back to int/float (_out), so callers never
see DynamoDB types.
"""
import datetime
import decimal
import hashlib
import uuid
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key

from common import config

TASK_STATUSES = {"open", "done", "dropped"}
_PK = f"USER#{config.USER_ID}"
_table_handle = None


def _table():
    """Lazy table binding so pure helpers stay importable without AWS."""
    global _table_handle
    if _table_handle is None:
        _table_handle = boto3.resource("dynamodb").Table(config.TABLE_NAME)
    return _table_handle


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _clean(o: Any) -> Any:
    """DynamoDB rejects Python floats; model JSON is full of them."""
    if isinstance(o, float):
        return decimal.Decimal(str(o))
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    return o


def _out(o: Any) -> Any:
    """Inverse boundary: strip key attrs, coerce Decimal back to numbers."""
    if isinstance(o, decimal.Decimal):
        return float(o) if o % 1 else int(o)
    if isinstance(o, dict):
        return {k: _out(v) for k, v in o.items() if k not in ("PK", "SK")}
    if isinstance(o, list):
        return [_out(v) for v in o]
    return o


def _query_all(**kwargs) -> list[dict]:
    """Query with pagination; accumulated results, not just the first page."""
    items = []
    resp = _table().query(**kwargs)
    items.extend(resp.get("Items", []))
    while "LastEvaluatedKey" in resp and "Limit" not in kwargs:
        resp = _table().query(ExclusiveStartKey=resp["LastEvaluatedKey"], **kwargs)
        items.extend(resp.get("Items", []))
    return items


# ---------- tasks ----------

def put_task(task: dict) -> dict:
    task.setdefault("id", uuid.uuid4().hex[:12])
    task.setdefault("status", "open")
    task.setdefault("created_at", _now())
    item = _clean({"PK": _PK, "SK": f"TASK#{task['id']}", **task})
    _table().put_item(Item=item)
    return task


def list_tasks(status: str | None = None) -> list[dict]:
    kwargs: dict[str, Any] = dict(
        KeyConditionExpression=Key("PK").eq(_PK) & Key("SK").begins_with("TASK#"))
    if status:
        kwargs["FilterExpression"] = Attr("status").eq(status)
    items = [_out(i) for i in _query_all(**kwargs)]
    return sorted(items, key=lambda i: i.get("created_at", ""), reverse=True)


def update_task(task_id: str, fields: dict) -> None:
    allowed = {k: v for k, v in fields.items()
               if k in {"title", "notes", "project", "status", "due", "triage"}}
    if not allowed:
        return
    if "status" in allowed and allowed["status"] not in TASK_STATUSES:
        raise ValueError(f"invalid status {allowed['status']!r}; "
                         f"must be one of {sorted(TASK_STATUSES)}")
    expr = ", ".join(f"#f{i} = :v{i}" for i in range(len(allowed)))
    names = {f"#f{i}": k for i, k in enumerate(allowed)}
    values = {f":v{i}": _clean(v) for i, v in enumerate(allowed.values())}
    # attribute_exists stops UpdateItem from upserting phantom items for
    # unknown ids (the model occasionally invents task ids).
    _table().update_item(
        Key={"PK": _PK, "SK": f"TASK#{task_id}"},
        UpdateExpression=f"SET {expr}",
        ConditionExpression="attribute_exists(PK)",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


# ---------- sitreps (daily game plans) ----------

def put_sitrep(date: str, body: dict, *, block_status: dict | None = None,
               revision: int = 0, replanned_at: str | None = None) -> None:
    """Store the day's plan. A fresh generate resets block_status and
    revision; a replan passes carried-over values explicitly."""
    item = {"PK": _PK, "SK": f"SITREP#{date}", "date": date,
            "body": body, "created_at": _now(),
            "block_status": block_status or {}, "revision": revision}
    if replanned_at:
        item["replanned_at"] = replanned_at
    _table().put_item(Item=_clean(item))


def get_sitrep(date: str) -> dict | None:
    resp = _table().get_item(Key={"PK": _PK, "SK": f"SITREP#{date}"})
    item = resp.get("Item")
    return _out(item) if item else None


def latest_sitrep() -> dict | None:
    resp = _table().query(
        KeyConditionExpression=Key("PK").eq(_PK) & Key("SK").begins_with("SITREP#"),
        ScanIndexForward=False, Limit=1)
    items = resp.get("Items", [])
    return _out(items[0]) if items else None


BLOCK_STATUSES = {"done", "skipped"}


def set_block_status(date: str, index: Any, status: str | None) -> dict:
    """Record how a time block actually went; None clears the mark.

    Stored as a top-level map on the sitrep item, keyed by the block's index
    in body.execution.time_blocks. Read-modify-write is fine single-user.
    Returns the updated map. Raises ValueError on bad input or missing plan.
    """
    if status is not None and status not in BLOCK_STATUSES:
        raise ValueError(f"invalid block status {status!r}; "
                         f"must be one of {sorted(BLOCK_STATUSES)} or null")
    item = get_sitrep(date)
    if item is None:
        raise ValueError(f"no plan on record for {date}")
    blocks = (item.get("body", {}).get("execution", {}) or {}).get("time_blocks") or []
    if not isinstance(index, int) or not (0 <= index < len(blocks)):
        raise ValueError(f"block index {index!r} out of range (plan has {len(blocks)} blocks)")
    statuses = {str(k): v for k, v in (item.get("block_status") or {}).items()}
    if status is None:
        statuses.pop(str(index), None)
    else:
        statuses[str(index)] = status
    _table().update_item(
        Key={"PK": _PK, "SK": f"SITREP#{date}"},
        UpdateExpression="SET block_status = :s",
        ConditionExpression="attribute_exists(PK)",
        ExpressionAttributeValues={":s": _clean(statuses)},
    )
    return statuses


# ---------- debriefs ----------

def put_debrief(date: str, answers: dict, analysis: dict) -> None:
    _table().put_item(Item=_clean({"PK": _PK, "SK": f"DEBRIEF#{date}", "date": date,
                                   "answers": answers, "analysis": analysis,
                                   "created_at": _now()}))


def recent_debriefs(limit: int = 5) -> list[dict]:
    resp = _table().query(
        KeyConditionExpression=Key("PK").eq(_PK) & Key("SK").begins_with("DEBRIEF#"),
        ScanIndexForward=False, Limit=limit)
    return [_out(i) for i in resp.get("Items", [])]


# ---------- preferences ----------

def get_preferences() -> list[dict]:
    resp = _table().get_item(Key={"PK": _PK, "SK": "PREF#profile"})
    return _out(resp.get("Item", {}).get("preferences", []))


def _merge_preferences(existing: list[dict], new: list[dict], now: str,
                       cap: int = 40) -> list[dict]:
    """Merge by text; a reconfirmed preference moves to the end (most recent)
    with a refreshed learned_at, so the cap evicts stale items, not
    repeatedly-reinforced ones."""
    merged = list(existing)
    for p in new:
        text = p.get("text")
        if not text:
            continue
        merged = [m for m in merged if m.get("text") != text]
        merged.append({**p, "learned_at": now})
    return merged[-cap:]


def append_preferences(new_prefs: list[dict]) -> None:
    prefs = _merge_preferences(get_preferences(), new_prefs, _now())
    _table().put_item(Item=_clean({"PK": _PK, "SK": "PREF#profile",
                                   "preferences": prefs, "updated_at": _now()}))


def preference_id(text: str) -> str:
    """Stable id for a preference, derived from its text (the merge key)."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def delete_preference(pref_id: str) -> bool:
    """Remove one learned preference by its id. True if something was removed."""
    prefs = get_preferences()
    kept = [p for p in prefs if preference_id(p.get("text", "")) != pref_id]
    if len(kept) == len(prefs):
        return False
    _table().put_item(Item=_clean({"PK": _PK, "SK": "PREF#profile",
                                   "preferences": kept, "updated_at": _now()}))
    return True
