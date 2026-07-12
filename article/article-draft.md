# Weekend Productivity Challenge: Game Plan OS — An AI That Plans Your Day Like a Mission

<!-- Builder Center tag: #productivity -->
<!-- Publish-ready draft; tweak voice anywhere. Screenshots: you upload 00-07
     from article/screenshots/ (plus inbox email / DynamoDB shots if desired). -->

## Vision & What the App Does

In Special Forces, we never started a day without an operations order. Not a
to-do list — an order: a single mission, a scheme of maneuver, a named reserve,
and the decision points where the plan was allowed to change. A to-do list is
inventory. An order is a decision.

When I left the military and started running companies, I kept the discipline
and lost the format. My task load lives across three ventures, a nonprofit, a
podcast, and a community — and like most founders, my failure mode isn't
laziness. It's the opposite: seven "priorities," a calendar scheduled to 110%,
and no one with the authority to tell me what to drop.

So I built Game Plan OS: a personal AI operations officer. It's not a chatbot
you have to remember to talk to. It runs on a daily rhythm:

- **Throughout the day**, I brain-dump everything into one box — half-formed,
  unstructured, exactly as it arrives. A fast model triages the dump into
  discrete tasks, each scored for urgency, impact, and honest effort.
- **Every morning at 0530**, a reasoning model reads my open tasks, my recent
  debriefs, and everything it has learned about how I actually work, and
  writes the day's game plan in the spirit of the military five-paragraph
  operations order:
  **Situation** (the terrain, what changed overnight), **Mission** (one
  sentence, one objective, measurable by end of day), **Execution**
  (time blocks with intent, priorities ranked P1–P3, and — critically — what
  gets *deliberately dropped*, with reasons), **Sustainment** (energy, breaks),
  and **Command & Signal** (decision points, blockers, and what to say no to
  today). It lands in my inbox and on a dashboard.
- **As the day moves**, the plan is answerable. I mark blocks done or
  skipped, and when reality diverges I report in — "finished the memo early;
  dentist ran long" — and the plan renegotiates only the rest of the day: the
  mission stays pinned, finished blocks stay history, and every new cut comes
  with a reason. If I disagree with something it dropped, one click challenges
  the cut and sends it back for renegotiation.
- **Every evening**, it debriefs me: three questions generated from that
  morning's actual order, never generic. An after-action review compares plan
  to reality, names what slipped and why, and — when a pattern shows up across
  multiple debriefs — writes a preference into my profile. "Estimates on
  writing tasks run 2x long; pad them." Tomorrow's order is built on it.
  Everything it learns is visible on a Memory tab, and anything wrong can be
  deleted — a learning system you cannot inspect is a system you cannot trust.

The doctrine is opinionated by design: one mission only, never more than 70%
of working hours scheduled (unallocated time is the reserve — friction always
comes), and an explicit overcommitment warning when the week's load is not
achievable.

**About the name.** I originally called this SITREP — it's catchy, and if you
know it from NATO doctrine or from Call of Duty it means the same thing. Then
a night of sleep surfaced the doctrinal bug: the morning artifact is an
*order* (an OPORD — a decision about what happens next), while a SITREP is a
*report* on the current situation. Naming the whole app after the wrong
document is exactly the kind of thing an after-action review is supposed to
catch, so I renamed it Game Plan OS — plain English, welcoming to people who
never wore a uniform — and let the term SITREP live where it is actually
correct: the evening debrief, which really is an end-of-day situation report.

## How I Built It

The build ran Friday night to Saturday evening. Friday night went to the
backend: SAM stack up (Lambda, DynamoDB, API Gateway, EventBridge Scheduler,
SES), the first real game plan generated within the hour — one mission,
five time blocks, two tasks explicitly dropped with reasons — and, once the
verbs existed, the conversational agent on top of them. Saturday went to the
learning loop, the console and its landing page, the rename, and making the
plan answerable mid-day — with this article closing out the evening.

The build ran backend-first, and the key decisions were mostly about what
*not* to build:

**One decision per model.** Nova Pro handles the two reasoning-heavy jobs —
the morning order and the evening after-action review. Nova Lite handles
triage, because classifying a brain dump is extraction, not judgment, and I
wanted dumping to be so cheap I'd never hesitate. Both run through Bedrock's
Converse API with strict JSON schemas and a single stern retry when a model
gets creative with markdown fences.

**The prompt is the product.** Most of my development time went into the
system prompt's doctrine rules, not infrastructure. The difference between
"here are your tasks organized nicely" and an order with teeth — a real
mission, real drops, a warning that the week is overcommitted — is entirely
in those rules. Concrete example: my first evening debrief said I'd finished
one task and gotten "half a draft" of another — and the after-action model
cheerfully marked all five scheduled tasks done, which would have silently
emptied the task pool. The fix was a prompt rule, not code: a task may only be
closed on explicit evidence ("shipped the memo"), being scheduled is not
evidence, partial progress stays open, and when in doubt, omit — a wrongly
closed task disappears from every future plan. Re-ran the same debrief: one
task closed, four left open. That one rule is the difference between a
learning loop and a data-corruption loop.

**The learning loop earns the word "agent."** The debrief analysis
distinguishes one-off events from patterns, and only patterns supported by at
least two independent signals get persisted as preferences. Anything less
confident stays out of the profile. Without that filter, the agent learns
noise; with it, watching my own work patterns accumulate in a DynamoDB
document is genuinely uncomfortable in the way good feedback is.

**A plan you can answer back to.** The first version rendered the morning
order as read-only text, and using it surfaced the flaw immediately: a plan
you can only regenerate wholesale is a report, not a tool. So the plan schema
carries task IDs end to end (with hallucinated IDs scrubbed server-side),
every block takes a done or skipped mark, the drop list takes a challenge,
and a partial replan verb pins the mission and the finished morning while
rebuilding only what remains. Watching Nova Pro handle "the draft is
finished; a new urgent ask came in" — preserving history to the minute,
scheduling the new work at the current time, and moving the now-redundant
item to the drop list with the reason quoted back — was the moment this
stopped feeling like a demo.

**An agent as a doorway, not a brain.** Once the plan was answerable, I put
a conversational agent (Strands Agents SDK, in the same Lambda behind a
vendored dependencies layer) on top of it: ten tools, every one a thin
wrapper over a verb the product already had — list tasks, close one, mark a
block, replan the rest of the day. It talks through a dock in the console
and through a Telegram bot, and the same 0530 brief that lands in my inbox
now lands in the chat. The interesting engineering was not the wiring — it
was honesty, which gets its own war story below.

**Deliberate cuts.** No Cognito, no calendar integration, no multi-user —
a shared-secret header guards a single-principal tool. Every one of those
features was a schedule risk with zero payoff for a weekend challenge.
(Calendar and Todoist feeding the same brain are the obvious next phase,
and the architecture leaves room for them.)

The real snags, honestly: **DynamoDB rejected the model's JSON on the very
first call** — Nova returns `effort_hours: 1.5` and boto3 will not accept a
Python float, so every write path now runs a recursive float-to-Decimal
conversion. **The triage model resolved relative dates wrong** ("by friday"
landed on the wrong week) until the prompt included the weekday alongside
the date, and later a plain lookup table of the next seven days — models
(and, I discovered while reviewing its output, humans) are surprisingly bad
at weekday arithmetic, so the fix is to make it reading instead of math.
And the biggest one was conceptual, not technical: I shipped a doctrinally
wrong name and caught it in my own after-action review (see above).

## AWS Services Used / Architecture Overview

![Architecture diagram](architecture.png)
<!-- rendered from architecture.mmd; upload architecture.png to Builder Center -->


| Service | Role |
|---|---|
| **Amazon Bedrock (Nova Pro + Nova Lite)** | The operations officer: order generation, after-action analysis (Pro); brain-dump triage (Lite) |
| **AWS Lambda (Python 3.13)** | Two functions: the API router — which also hosts the Strands Agents SDK agent behind a vendored dependencies layer — and the scheduled morning brief |
| **Amazon API Gateway (HTTP API)** | REST surface for dump / tasks / generate / debrief |
| **Amazon DynamoDB** | Single table: `TASK#`, `SITREP#`, `DEBRIEF#`, `PREF#` — the whole system state |
| **Amazon EventBridge Scheduler** | Timezone-aware cron: 0530 America/Chicago, every day |
| **Amazon SES** | Delivers the morning order to my inbox |
| **AWS Amplify Hosting** | Serves the React dashboard |

The flow: brain dumps hit API Gateway → Lambda → Nova Lite → DynamoDB. At
0530, EventBridge Scheduler wakes the brief Lambda, which assembles context
(open tasks, preferences, five most recent debriefs, yesterday's order),
calls Nova Pro, persists the order, and mails it via SES (and pushes it to
Telegram). The evening debrief runs the same path in reverse: answers →
Nova Pro after-action → task status updates and high-confidence preferences
back into DynamoDB. The agent is a third doorway into the same flow: a
message from the console dock or the Telegram webhook reaches a Strands
agent whose ten tools wrap the same service layer, so "I finished the memo,
replan my afternoon" mutates the same DynamoDB plan the console renders.

Everything except Bedrock usage beyond the trial sits comfortably in the Free
Tier for a single user: pay-per-request DynamoDB, two small Lambdas, one
scheduled event a day, one email a day.

## What I Learned

- **Converse API JSON discipline.** Schema-in-prompt plus a defensive parser
  and one low-temperature retry turned out to be more reliable than I
  expected — and cheaper than tool-calling for pure-JSON workloads.
- **EventBridge Scheduler's timezone-aware cron** eliminates the classic
  UTC-offset bug entirely. `cron(30 5 * * ? *)` in `America/Chicago` just
  works, DST included.
- **Model-to-job matching is a product decision, not a cost hack.** Triage on
  Nova Lite isn't just cheaper; its speed changes user behavior — dumping
  becomes frictionless, which means the reasoning model sees more complete
  context every morning.
- **An opinionated prompt beats a capable model with a polite one.** The same
  model, same context, produces either a summary or an order depending
  entirely on whether the doctrine rules give it permission to be decisive.
- **The agent layer was thin, because the verbs already existed.** I expected
  wiring a conversational agent (Strands Agents SDK in a Lambda, Telegram as
  the channel) to be the hardest lift of the weekend. The wiring was the
  easiest part — every tool the agent needed already existed as a product
  verb with an addressable API: list tasks, close one, mark a block done,
  replan the rest of the day. Make the product answerable first, and an
  agent is just a new doorway into the same room.
- **The hard part of the agent was honesty, and prompts alone did not fix
  it.** In live testing, Nova Pro would answer "the task has been dropped"
  without ever calling the tool — pattern-completing from conversation
  context — and once that false confirmation entered the chat history, it
  defended it ("already dropped") on every following turn. Prompt rules
  helped; they did not hold. What held was structure: the runtime compares
  the reply against the tools that actually ran, and a claimed change with
  no tool call triggers a retry on a fresh context — because the poisoned
  history is precisely what teaches the model to keep lying — and if even
  that round claims without acting, the user gets an honest "I changed
  nothing" instead. Trust the receipt, never the prose. (A smaller surprise
  was channel economics: a Telegram bot is live in minutes and can message
  you first, while US SMS is a weeks-long carrier-registration project.
  Channel choice turned out to be a regulatory decision, not a technical
  one.)

## Link to App & Repo

- **Repo:** https://github.com/AltivumInc-Admin/gameplan-os (public — code,
  prompts, SAM template, and deployment guide)
- **Live app:** https://gameplan.altivum.ai — deployed on Amplify Hosting
  with CI/CD from the repo, behind a custom domain. The landing page itself is a
  working demo: it renders a sample morning brief with the real console
  components, so you can hover the timeline and mark blocks done without a
  key. The console behind the access key is single-principal by design; the
  screenshots below show the working loop. Light and dark themes throughout.
- Screenshots ready in `article/screenshots/`: 00 landing page (generated
  dawn-terrain hero), 01 game plan hero (timeline + replan bar), 02 full
  five-section plan with block actions, 03 task pool with triage scores and
  inline editing, 04 evening debrief questions, 05 after-action review with
  learned preferences, 06 the Memory tab, 07 the light theme, 08 the agent
  dock mid-conversation with its action receipts.

---

*Built solo over the July 10–13 weekend for the AWS Builder Center
Productivity Challenge. The five-paragraph order format has survived a century
of contact with reality; it turns out it survives contact with a founder's
task list too.*
