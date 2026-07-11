# Market research: the productivity landscape and the void (2026-07-11)

Produced by a 6-agent research workflow (AI-planner landscape, conversational
agent capture, integration costs, landing/onboarding craft, honest audit of
this app, synthesis). Kept as ground truth for product decisions and article
material.

## Where we stand (honest audit)

Game Plan OS has exactly five data-mutating verbs (dump, generate, task done,
task drop, debrief submit). The Brief — the hero surface — renders 30+ plan
elements as pure text with zero affordances: no block can be completed,
extended, edited, or objected to. Plan items carry no task IDs, so the Brief
and the Tasks table are two disconnected representations of the same work.
The learned preference profile (our stated differentiator) is write-only:
invisible, uncorrectable. The debrief silently closes tasks with no receipt.
The only correction tool is a full nondeterministic Regenerate. The founder
critique ("I see everything I have to do but I can't do anything with it")
is ~90 percent confirmed. Crucially: the backend already supports the fixes
(PATCH /tasks, POST /tasks, stored plans/debriefs) — inertness is a frontend
and channel problem, not an architecture problem.

## The landscape: two occupied poles

**Pole 1 — mechanical automation** (Motion $29-49/mo, Reclaim, Trevor):
constraint-solver calendar packing. Complaints: robotic and context-blind
("schedules based on when you're free, not when you're capable"),
dependency-blind ordering, rescheduling treadmill, 2-4 week setup ramp,
Motion at 2.7/5 on Google Play, chronic billing-trust erosion.

**Pole 2 — deferred judgment** (Sunsama $20/mo, Ellie, Morgen): guided
rituals where the human decides everything. Complaints: ritual compliance
cost ("commit to the daily practice or don't start"), no auto-rescheduling,
mass abandonment.

**Cross-cutting finding:** across the whole category, marketed "AI"
decomposes into (a) natural-language capture, (b) task decomposition,
(c) constraint-solver packing. None of it decides WHAT matters, says no
for you, or explains its reasoning.

**Conversational layer:** Dola (~500k users, free, WhatsApp/Telegram/iMessage)
and Martin ($21-49/mo, SMS/WhatsApp/phone) prove chat capture + proactive
morning briefs are the loved features — but they are stenographers: capture
and remind, no judgment, no planning. Frontier assistants (Claude, ChatGPT)
are absorbing calendar + memory but still cannot message you first.

## The void

A planner that exercises **accountable judgment** — one mission, a defended
drop list, a stated reason for every cut — **delivered proactively into the
chat app you already use**, that **renegotiates the plan mid-day** when you
report what actually happened. Chat capture is commoditized; calendar packing
is table stakes. The wedge is not "text your planner" — it is "text a planner
that has an opinion, defends it, and revises it like a chief of staff, not
a stenographer."

**Positioning line:** Every AI planner packs whatever you feed it into
calendar gaps; Game Plan OS is the one that decides what you are NOT doing
today, tells you why, and texts you a revised call when your day changes.

## What we already own

1. The drop list with reasons — the only artifact in the category that says
   no on the user's behalf and explains why.
2. The one-mission operations-order format: a plan as an argument, not a
   bin-packing solution.
3. A working learn-from-debrief loop persisting to DynamoDB.
4. Day-one value with zero configuration (inverts Motion's ramp, Sunsama's
   ritual).
5. Serverless cost structure (sub-$15/mo viable; category is $15-49 with
   billing-trust complaints) + native Strands path to the agent layer.

## Ranked gaps (build order)

1. **Make the plan answerable** (a day): task IDs in the plan schema;
   complete/veto/edit on blocks, drops, priorities; task-row editing;
   undo/reopen. Prerequisite for everything conversational.
2. **Telegram channel** (multi-day): proactive morning brief push + report-in
   loop ("finished the memo, dentist ran long") triggering partial replan.
   Telegram is the only channel that is instant, free, and allows
   bot-initiated pushes (US SMS = 3-6 week A2P 10DLC registration project).
3. **Partial replan verb** (a day): pin mission + completed blocks, rebuild
   only the remaining day. Replaces the all-or-nothing Regenerate.
4. **Show the learning** (hours): visible/editable preferences, debrief
   closure receipts, yesterday's AAR surfaced in the morning brief.
5. **Google Calendar read** (a day): OAuth app in unverified-Production mode
   (Testing mode refresh tokens die after 7 days — the classic silent
   breaker); read-only scope; feed real events into generation.
6. **Todoist sync** (hours): personal API token; target unified API v1 ONLY
   (REST v2 / Sync v9 deprecated, removal ~beginning of 2026). Official
   hosted MCP server exists (ai.todoist.net/mcp).

## Integration setup facts (for a personal, no-review build)

- Todoist: personal API token, 15-30 min.
- Telegram: BotFather token in minutes; bot cannot message first — user must
  /start once, then store chat_id; webhook supports secret_token header.
- Slack: single-workspace app, bot token on install, no review; 3-second ack
  rule on slash commands (ack first, post via response_url after LLM work).
- Google Calendar: 2-4 h OAuth ceremony; events.list with timeMin/timeMax,
  singleEvents=true; calendar.readonly is a sensitive scope; quota
  irrelevant at personal scale.

## Landing-page craft (2026 consensus)

- Demonstration over decoration: real product UI as the hero (Linear,
  Cursor), or the AI mid-task (Superhuman). "Real screens over abstract
  shapes."
- Numbered workflow chapters signal craft to technical buyers (Linear's
  1.0 Intake / 2.0 Plan spec aesthetic).
- Embedded interactive demos massively outperform video (Navattic/Arcade:
  top demos 84% engagement; Wrike +65% onboarding conversion). Ladder:
  video < clickable tour < unguided sandbox < real product running.
- Scramble/decode text is a commodity effect: use once, on the hero, as a
  craft signal.
- Full-WebGL spatial scenes (Igloo, Awwwards SOTY) are brand theater, not
  conversion — borrow depth/scene-shift vocabulary in CSS instead.
- CSS scroll-driven animations + View Transitions shipped stable 2025 —
  scroll storytelling no longer needs a JS framework.
- The blank first session is the primary drop-off: pre-populate sample
  content (Notion), script the first wow to under 60 seconds (Superhuman),
  teach the power interaction first (Linear's Cmd+K).
