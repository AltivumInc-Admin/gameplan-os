"""Pure-function tests for the agent's channel plumbing (no AWS, no strands).

Covers telegram.chunk_text / parse_update and db.cap_chat - the helpers whose
edge cases (message limits, malformed webhooks, history pairing) would
otherwise only surface live.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("TABLE_NAME", "test-table")
os.environ.setdefault("NOTIFY_EMAIL", "test@example.com")

from agent import guards  # noqa: E402
from common import db, telegram  # noqa: E402
from prompts import triage_prompt  # noqa: E402


class GuardsTests(unittest.TestCase):
    def test_clean_reply_strips_thinking_block(self):
        self.assertEqual(
            guards.clean_reply("<thinking> plan </thinking> Task added."),
            "Task added.")

    def test_clean_reply_multiline_and_multiple(self):
        text = "<thinking>a\nb</thinking> One. <thinking>c</thinking> Two."
        self.assertEqual(guards.clean_reply(text), "One.  Two.")

    def test_clean_reply_unclosed_tag_keeps_content(self):
        self.assertEqual(guards.clean_reply("<thinking> Task dropped."),
                         "Task dropped.")

    def test_clean_reply_plain_text_untouched(self):
        self.assertEqual(guards.clean_reply("  All set. "), "All set.")

    def test_claim_without_tool_detected(self):
        self.assertTrue(guards.claims_change_without_tool(
            "The task has been dropped.", []))
        self.assertTrue(guards.claims_change_without_tool(
            "I marked the block as skipped.", []))

    def test_claim_with_tool_passes(self):
        self.assertFalse(guards.claims_change_without_tool(
            "The task has been dropped.", ["drop_task"]))

    def test_no_claim_no_tool_passes(self):
        self.assertFalse(guards.claims_change_without_tool(
            "Your mission today is the investor memo.", []))


class ChunkTextTests(unittest.TestCase):
    def test_empty_and_whitespace(self):
        self.assertEqual(telegram.chunk_text(""), [])
        self.assertEqual(telegram.chunk_text("   \n  "), [])

    def test_short_text_single_chunk(self):
        self.assertEqual(telegram.chunk_text("hello"), ["hello"])

    def test_splits_on_newline_boundary(self):
        text = "a" * 50 + "\n" + "b" * 50
        chunks = telegram.chunk_text(text, limit=60)
        self.assertEqual(chunks, ["a" * 50, "b" * 50])

    def test_hard_split_without_newlines(self):
        chunks = telegram.chunk_text("x" * 150, limit=60)
        self.assertEqual([len(c) for c in chunks], [60, 60, 30])
        self.assertEqual("".join(chunks), "x" * 150)

    def test_every_chunk_within_telegram_limit(self):
        text = ("line of reasonable length\n" * 800).strip()
        for chunk in telegram.chunk_text(text):
            self.assertLessEqual(len(chunk), telegram.MAX_MESSAGE_CHARS)

    def test_no_content_lost(self):
        text = "\n".join(f"line {i}" for i in range(500))
        joined = "\n".join(telegram.chunk_text(text, limit=100))
        self.assertEqual(joined, text)


class ParseUpdateTests(unittest.TestCase):
    def _update(self, **msg):
        return {"update_id": 42, "message": {
            "text": "hello", "chat": {"id": 1234}, **msg}}

    def test_valid_text_message(self):
        parsed = telegram.parse_update(self._update())
        self.assertEqual(parsed, {"update_id": 42, "chat_id": "1234",
                                  "text": "hello"})

    def test_strips_whitespace(self):
        parsed = telegram.parse_update(self._update(text="  hi  "))
        self.assertEqual(parsed["text"], "hi")

    def test_non_dict_and_missing_message(self):
        self.assertIsNone(telegram.parse_update(None))
        self.assertIsNone(telegram.parse_update("nonsense"))
        self.assertIsNone(telegram.parse_update({"update_id": 1}))
        self.assertIsNone(telegram.parse_update({"message": "not a dict"}))

    def test_non_text_message_ignored(self):
        update = {"update_id": 1, "message": {"sticker": {}, "chat": {"id": 5}}}
        self.assertIsNone(telegram.parse_update(update))

    def test_empty_text_ignored(self):
        self.assertIsNone(telegram.parse_update(self._update(text="   ")))

    def test_missing_chat_id_ignored(self):
        update = {"update_id": 1, "message": {"text": "hi", "chat": {}}}
        self.assertIsNone(telegram.parse_update(update))

    def test_edited_message_ignored(self):
        update = {"update_id": 1, "edited_message": {
            "text": "hi", "chat": {"id": 5}}}
        self.assertIsNone(telegram.parse_update(update))


class NextWeekTableTests(unittest.TestCase):
    def test_weekend_resolution(self):
        # 2026-07-11 is a Saturday; "Sunday" from it must be 2026-07-12.
        # (Writing this test caught a human miscount, not a model one - the
        # table exists so neither party does weekday math again.)
        table = triage_prompt.next_week_table("2026-07-11")
        self.assertIn("Sunday = 2026-07-12", table)
        self.assertIn("Monday = 2026-07-13", table)
        self.assertNotIn("2026-07-11", table)  # today itself is not "coming"

    def test_seven_rows_crossing_month_end(self):
        table = triage_prompt.next_week_table("2026-07-29")
        self.assertEqual(len(table.splitlines()), 7)
        self.assertIn("2026-08-01", table)


class CapChatTests(unittest.TestCase):
    def _messages(self, n):
        out = []
        for i in range(n):
            out.append({"role": "user", "text": f"u{i}"})
            out.append({"role": "assistant", "text": f"a{i}"})
        return out

    def test_under_cap_unchanged(self):
        msgs = self._messages(3)
        self.assertEqual(db.cap_chat(msgs, cap=10), msgs)

    def test_caps_to_newest(self):
        msgs = self._messages(30)  # 60 messages
        capped = db.cap_chat(msgs, cap=10)
        self.assertEqual(len(capped), 10)
        self.assertEqual(capped[-1]["text"], "a29")

    def test_never_starts_with_assistant(self):
        msgs = self._messages(30)
        # An odd cap would land on an assistant message first; it gets dropped.
        capped = db.cap_chat(msgs, cap=11)
        self.assertEqual(capped[0]["role"], "user")
        self.assertEqual(len(capped), 10)

    def test_empty(self):
        self.assertEqual(db.cap_chat([], cap=10), [])


if __name__ == "__main__":
    unittest.main()
