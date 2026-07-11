# Design: the chief-of-staff pivot (approved 2026-07-11)

User-approved direction. Research basis: docs/market-research-2026-07-11.md.
Positioning: every AI planner packs what you feed it into calendar gaps;
Game Plan OS decides what you are NOT doing today, tells you why, and texts
you a revised call when your day changes.

## Sequencing (approved)

- Friday: Phase 1 (answerable plan) + Phase 2 (landing + light/dark).
- Saturday: Phase 3 (Strands agent, in-app chat + Telegram channel,
  proactive brief push). Article published Saturday evening.
- Hard fallback: publish Sunday 9 AM regardless of state.
- Sat night/Sun+: Phase 4 integrations - Google Calendar read, Todoist
  sync, Slack brief DM (all three approved; each has a one-time user step).

## Phase 1 - the answerable plan

Backend (all within existing SAM stack):
- Plan schema emits task_id on priorities and drops; blocks may carry
  task_ids. Prompt + _validate_plan/_normalize updated; old stored plans
  (no IDs) must still render.
- Block status map persisted on the sitrep item: {block_idx: done|skipped}
  via new route PATCH /sitrep/{date}/blocks.
- POST /sitrep/replan: pins mission + done blocks + current time; rebuilds
  only the remaining day; stores replanned_at + revision count.
- Task reopen: status open allowed from done/dropped (undo).
- GET /preferences, DELETE /preferences/{idx or hash}: the learned profile
  becomes visible and editable.
- Debrief response includes task_updates so the UI can show a receipt of
  which tasks were closed.

Frontend:
- Brief: hover/focus actions on timeline blocks (done, skip); veto/restore
  on drop items (restore = task back to open); "Replan the rest of the day"
  button; receipts after debrief; priority/drop rows link to their task.
- Tasks: quick-add single task (POST /tasks), inline triage editing
  (urgency/impact/effort/due/title), undo toast after done/drop, filter to
  view done/dropped.
- New Memory tab: learned preferences listed, deletable; plain-language
  framing ("what it has learned about how you work").

## Phase 2 - the front door

- Landing replaces the bare Gate for unauthenticated visitors: cinematic
  scroll narrative. Hero: Higgsfield dawn-terrain art (candidate 2, bold
  route) full-bleed, decode-in headline, subtle parallax. Then numbered
  chapters (01 Dump -> 02 The 0530 brief -> 03 Work the day -> 04 Debrief
  -> 05 It learns) where the demo IS the real product: sample plan rendered
  by the actual SitrepView components, interactive, no key needed.
  Demonstration over decoration (2026 evidence). Scramble/decode used once.
- Enter section: access key input (existing probe logic) + GitHub source.
- Light/dark toggle app-wide: [data-theme] token overrides, toggle in
  header and landing, localStorage + prefers-color-scheme default. Light
  theme = printed-order aesthetic: true neutral paper, ink text, same
  green accent (darkened for AA), hairline rules.

## Phase 3 - the agent (Saturday)

- Strands Agents (Python) Lambda in the SAM stack, Bedrock Nova Pro.
- Tools wrap the service layer: list/add/complete/reopen tasks, get plan,
  set block status, replan remaining day, record note for tonight's
  debrief, list preferences.
- Channels: POST /agent/chat (in-app dock) and POST /agent/telegram
  (webhook; BotFather token as NoEcho param in SSM/env, secret_token header
  check, chat_id allowlist). Proactive: 0530 brief also pushed to Telegram;
  midday check-in optional.
- User steps: create bot with @BotFather, /start it once.

## Phase 4 - integrations

- Google Calendar read-only (OAuth app in unverified-Production mode, NOT
  Testing - 7-day refresh token expiry; calendar.readonly). Events feed
  plan generation as fixed commitments.
- Todoist personal API token; unified API v1 only. Pull into task pool
  before generation; push completions back.
- Slack single-workspace app, chat.postMessage DM of the morning brief.

## Voice and register

Military framework stays backbone-not-spirit: plain language, every
borrowed term explained, no emojis, no em dashes in AWS resources. Landing
copy leads with judgment ("decides what you are not doing today, and tells
you why"), not military theming.
