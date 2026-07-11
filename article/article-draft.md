# Weekend Productivity Challenge: Game Plan OS — An AI That Plans Your Day Like a Mission

<!-- Builder Center tag: #productivity -->
<!-- Target 900–1,200 words. [TODO] blocks are yours; everything else is editable draft. -->

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
- **Every evening**, it debriefs me: three questions generated from that
  morning's actual order, never generic. An after-action review compares plan
  to reality, names what slipped and why, and — when a pattern shows up across
  multiple debriefs — writes a preference into my profile. "Estimates on
  writing tasks run 2x long; pad them." Tomorrow's order is built on it.

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

I started Friday with the backend: SAM stack up (Lambda, DynamoDB, API
Gateway, EventBridge Scheduler, SES), and the first real game plan generated
within the hour — one mission, five time blocks, two tasks explicitly dropped
with reasons. Saturday went to the learning loop, the frontend console, and
the rename. [TODO: adjust timeline details to taste.]

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

**Deliberate cuts.** No Cognito, no calendar integration, no multi-user —
a shared-secret header guards a single-principal tool. Every one of those
features was a schedule risk with zero payoff for a weekend challenge.

The real snags, honestly: **DynamoDB rejected the model's JSON on the very
first call** — Nova returns `effort_hours: 1.5` and boto3 will not accept a
Python float, so every write path now runs a recursive float-to-Decimal
conversion. **The triage model resolved relative dates wrong** ("by friday"
landed on the wrong week) until the prompt included the weekday alongside the
date — models are surprisingly bad at knowing what day of the week a date is.
And the biggest one was conceptual, not technical: I shipped a doctrinally
wrong name and caught it in my own after-action review (see above).

## AWS Services Used / Architecture Overview

![Architecture diagram](TODO-upload-rendered-architecture.png)

| Service | Role |
|---|---|
| **Amazon Bedrock (Nova Pro + Nova Lite)** | The operations officer: order generation, after-action analysis (Pro); brain-dump triage (Lite) |
| **AWS Lambda (Python 3.13)** | Two functions: API router and the scheduled morning brief |
| **Amazon API Gateway (HTTP API)** | REST surface for dump / tasks / generate / debrief |
| **Amazon DynamoDB** | Single table: `TASK#`, `SITREP#`, `DEBRIEF#`, `PREF#` — the whole system state |
| **Amazon EventBridge Scheduler** | Timezone-aware cron: 0530 America/Chicago, every day |
| **Amazon SES** | Delivers the morning order to my inbox |
| **AWS Amplify Hosting** | Serves the React dashboard |

The flow: brain dumps hit API Gateway → Lambda → Nova Lite → DynamoDB. At
0530, EventBridge Scheduler wakes the brief Lambda, which assembles context
(open tasks, preferences, five most recent debriefs, yesterday's order),
calls Nova Pro, persists the order, and mails it via SES. The evening debrief
runs the same path in reverse: answers → Nova Pro after-action → task status
updates and high-confidence preferences back into DynamoDB.

Everything except Bedrock usage beyond the trial sits comfortably in the Free
Tier for a single user: pay-per-request DynamoDB, two small Lambdas, one
scheduled event a day, one email a day.

## What I Learned

[TODO: keep the 3–4 that were actually true for you; delete the rest.]

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
- [TODO if Phase 2 attempted: one honest paragraph on AgentCore harness —
  what the config-defined agent replaced, what broke, whether Memory's
  preference extraction beat the hand-rolled filter.]

## Link to App & Repo

- **Repo:** https://github.com/AltivumInc-Admin/gameplan-os (public — code,
  prompts, SAM template, and deployment guide)
- **Live app:** https://main.dpg1b347fl82l.amplifyapp.com — deployed on
  Amplify Hosting with CI/CD from the repo. It is a single-principal personal
  tool behind an access key, so the screenshots below show the working loop.
- Screenshots ready in `article/screenshots/`: 01 game plan hero (timeline +
  mission), 02 full five-section plan, 03 task pool with triage scores,
  04 evening debrief questions, 05 after-action review with two learned
  preferences saved. [TODO: optionally add the morning email from your inbox
  and a DynamoDB console shot, then upload all to Builder Center.]

---

*Built solo over the July 10–13 weekend for the AWS Builder Center
Productivity Challenge. The five-paragraph order format has survived a century
of contact with reality; it turns out it survives contact with a founder's
task list too.*
