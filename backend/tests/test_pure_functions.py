"""Targeted tests for the load-bearing pure functions.

Run from the repo root:  python3 -m unittest discover backend/tests -v

Env vars are stubbed before importing app modules; db's table binding is lazy,
so no AWS access happens here.
"""
import os
import sys
import unittest

os.environ.setdefault("TABLE_NAME", "test-table")
os.environ.setdefault("NOTIFY_EMAIL", "test@example.com")
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import decimal  # noqa: E402

from common import db, service  # noqa: E402
from common.bedrock import strip_json  # noqa: E402


class StripJsonTests(unittest.TestCase):
    """strip_json is the single gate every model response passes through."""

    def test_bare_json(self):
        self.assertEqual(strip_json('{"a": 1}'), {"a": 1})

    def test_fenced_json(self):
        self.assertEqual(strip_json('```json\n{"a": 1}\n```'), {"a": 1})

    def test_json_with_surrounding_prose(self):
        text = 'Here is the plan {you asked for}:\n{"a": {"b": 2}}\nDone.'
        # First "{" belongs to prose; parser must still find a valid object.
        with self.assertRaises(Exception):
            strip_json(text)  # documents the known limitation: prose braces break it

    def test_prose_without_stray_braces(self):
        text = 'Sure, here it is:\n{"a": {"b": 2}}\nHope that helps.'
        self.assertEqual(strip_json(text), {"a": {"b": 2}})

    def test_truncated_output_raises(self):
        with self.assertRaises(Exception):
            strip_json('{"a": {"b": ')

    def test_no_json_raises_valueerror(self):
        with self.assertRaises(ValueError):
            strip_json("no json here at all")


class CleanTests(unittest.TestCase):
    """DynamoDB float-to-Decimal coercion over realistic triage payloads."""

    def test_nested_floats_become_decimal(self):
        item = db._clean({"triage": {"effort_hours": 1.5, "scores": [2.5, 3]}})
        self.assertEqual(item["triage"]["effort_hours"], decimal.Decimal("1.5"))
        self.assertEqual(item["triage"]["scores"][0], decimal.Decimal("2.5"))
        self.assertEqual(item["triage"]["scores"][1], 3)

    def test_out_reverses_clean_and_strips_keys(self):
        stored = {"PK": "USER#x", "SK": "TASK#1", "title": "t",
                  "triage": {"effort_hours": decimal.Decimal("1.5"),
                             "urgency": decimal.Decimal("4")}}
        out = db._out(stored)
        self.assertNotIn("PK", out)
        self.assertEqual(out["triage"]["effort_hours"], 1.5)
        self.assertEqual(out["triage"]["urgency"], 4)
        self.assertIsInstance(out["triage"]["urgency"], int)


class MergePreferencesTests(unittest.TestCase):
    def test_dedupe_and_move_to_end(self):
        existing = [{"text": "a", "learned_at": "old"}, {"text": "b"}]
        merged = db._merge_preferences(existing, [{"text": "a"}], now="new")
        self.assertEqual([p["text"] for p in merged], ["b", "a"])
        self.assertEqual(merged[-1]["learned_at"], "new")

    def test_cap_evicts_oldest_not_reconfirmed(self):
        existing = [{"text": str(i)} for i in range(40)]
        # Reconfirm "0" (moves to end), then add one genuinely new preference:
        # the eviction should hit "1" (now the stalest), never the
        # just-reconfirmed "0".
        merged = db._merge_preferences(existing, [{"text": "0"}], now="n")
        self.assertEqual(len(merged), 40)
        self.assertEqual(merged[-1]["text"], "0")
        merged = db._merge_preferences(merged, [{"text": "new"}], now="n")
        self.assertEqual(len(merged), 40)
        texts = [p["text"] for p in merged]
        self.assertNotIn("1", texts)      # stalest evicted
        self.assertIn("0", texts)         # reconfirmed survived the cap
        self.assertEqual(texts[-1], "new")

    def test_blank_text_ignored(self):
        merged = db._merge_preferences([], [{"text": ""}, {}], now="n")
        self.assertEqual(merged, [])


class UpdateTaskValidationTests(unittest.TestCase):
    def test_invalid_status_rejected_before_any_aws_call(self):
        with self.assertRaises(ValueError):
            db.update_task("id123", {"status": "finished"})

    def test_empty_fields_are_a_noop(self):
        db.update_task("id123", {"unknown_field": 1})  # must not touch AWS


class NormalizeTaskTests(unittest.TestCase):
    def test_valid_task_normalized_and_clamped(self):
        t = service._normalize_task({
            "title": "  Do the thing  ", "id": "model-invented", "status": "done",
            "triage": {"urgency": 9, "impact": 0, "effort_hours": 100.0,
                       "rationale": "r"},
        })
        self.assertEqual(t["title"], "Do the thing")
        self.assertNotIn("id", t)       # model-supplied id dropped
        self.assertNotIn("status", t)   # model-supplied status dropped
        self.assertEqual(t["triage"]["urgency"], 5)
        self.assertEqual(t["triage"]["impact"], 1)
        self.assertEqual(t["triage"]["effort_hours"], 8)

    def test_garbage_rejected(self):
        self.assertIsNone(service._normalize_task("not a dict"))
        self.assertIsNone(service._normalize_task({"title": "   "}))
        self.assertIsNone(service._normalize_task({"notes": "no title"}))


class PlanValidationTests(unittest.TestCase):
    def _plan(self):
        return {k: {} for k in service.PLAN_SECTIONS} | {
            "mission": {"statement": "Ship it."}}

    def test_complete_plan_passes(self):
        service._validate_plan(self._plan())

    def test_missing_section_raises(self):
        plan = self._plan()
        del plan["execution"]
        with self.assertRaises(ValueError):
            service._validate_plan(plan)

    def test_empty_mission_raises(self):
        plan = self._plan()
        plan["mission"] = {"statement": "  "}
        with self.assertRaises(ValueError):
            service._validate_plan(plan)


class RenderEmailTests(unittest.TestCase):
    def test_full_body_renders_sections_in_order(self):
        body = {
            "date": "2026-07-11",
            "situation": {"overview": "Busy.", "changes_since_yesterday": ["c1"]},
            "mission": {"statement": "Ship X.", "why_decisive": "Because."},
            "execution": {
                "time_blocks": [{"start": "09:00", "end": "10:00",
                                 "label": "L", "intent": "I"}],
                "priorities": {"p1": [{"title": "T1"}], "p2": [], "p3": []},
                "deliberately_dropped": [{"title": "D", "reason": "R"}],
            },
            "sustainment": {"energy_plan": "Pace.", "breaks": ["12:00 lunch"]},
            "command_signal": {"decision_points": ["dp"], "say_no_to": ["no"],
                               "overcommitment_warning": None},
            "debrief_questions": ["q1?"],
        }
        text = service.render_email_text(body)
        order = [text.index(h) for h in
                 ("1. SITUATION", "2. MISSION", "3. EXECUTION",
                  "4. SUSTAINMENT", "5. COMMAND & SIGNAL")]
        self.assertEqual(order, sorted(order))
        self.assertIn("P1: T1", text)
        self.assertNotIn("P2:", text)          # empty tier omitted
        self.assertIn("DROPPED: D (R)", text)
        self.assertNotIn("OVERCOMMITMENT", text)

    def test_sparse_body_renders_no_none_and_no_dangling_labels(self):
        text = service.render_email_text(
            {"execution": {"time_blocks": [{"label": "only-label"}]}})
        self.assertNotIn("None", text)
        self.assertNotIn("P1:", text)
        self.assertNotIn("DROPPED:", text)
        self.assertNotIn("Why:", text)
        self.assertIn("?-?", text)  # missing block times degrade explicitly


if __name__ == "__main__":
    unittest.main()
