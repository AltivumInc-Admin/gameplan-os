# Game Plan OS — An AI That Plans Your Day Like a Mission

Every morning at 0530, Game Plan OS reads your open tasks, your learned
preferences, and your recent evening debriefs — and writes the day's game
plan, in the spirit of the military five-paragraph operations order:
**Situation, Mission, Execution, Sustainment, Command & Signal.** One decisive
mission. Explicit drops. Never more than 70% of your hours scheduled. Every
evening it debriefs you with three questions about how the day actually went,
runs an after-action review, and persists what it learned about how you really
work — so tomorrow's plan is smarter than today's.

Built for the AWS Builder Center **Build a Productivity App Weekend Challenge**
(July 10–13, 2026).

![Game Plan OS - today's game plan with the day timeline and visible reserve](article/screenshots/01-gameplan-hero.png)

Live app: https://main.dpg1b347fl82l.amplifyapp.com (single-user personal
tool behind an access key; see `article/screenshots/` for the working loop).

## Why a game plan instead of a to-do list

A to-do list is inventory. A plan is a decision. The military five-paragraph
order has survived a century of contact with reality because it forces three
things most productivity tools politely avoid: a single mission (not seven
priorities), explicit resource allocation (time blocks with intent, not hopes),
and a named reserve (unscheduled time, because friction always comes). The
evening debrief closes the loop — the after-action review is where the agent
earns the word "agent."

**A note on the name.** This project started life as "SITREP" — until a
night's sleep surfaced the doctrinal bug: the morning artifact is an *order*
(an OPORD — a decision about the future), while a SITREP is a *report* on the
current situation. So the product became Game Plan OS, and the term SITREP now
belongs where it is actually correct: the evening debrief, which really is an
end-of-day situation report. The naming bug never shipped; the format did.

## Architecture

```
Brain dump ──▶ API GW ──▶ Lambda ──▶ Nova Lite (triage) ──▶ DynamoDB
                                                              │
EventBridge Scheduler (0530 CT) ──▶ Lambda ──▶ Nova Pro ◀─────┤
                                        │   (5-para plan)     │
                                        ├──▶ SES (email)      │
                                        └──▶ DynamoDB ◀───────┘
Evening debrief ──▶ Lambda ──▶ Nova Pro (after-action) ──▶ preferences
React + Vite on Amplify Hosting ──▶ everything above
```

Full diagram: `article/architecture.mmd`.

| Layer | Service |
|---|---|
| Reasoning | Amazon Bedrock — Nova Pro (plan + after-action), Nova Lite (triage) |
| Compute | AWS Lambda (Python 3.13) |
| API | Amazon API Gateway (HTTP API) |
| Data | Amazon DynamoDB (single table) |
| Cadence | Amazon EventBridge Scheduler (timezone-aware cron) |
| Delivery | Amazon SES |
| Frontend | AWS Amplify Hosting (React + Vite) |

## Quick start

See `docs/DEPLOYMENT.md` for the full walkthrough. Short version:

```bash
# 1. Verify your SES identity (one-time, requires clicking an email link)
aws ses verify-email-identity --email-address you@example.com

# 2. Deploy the backend
sam build && sam deploy --guided

# 3. Run the frontend
cd frontend && npm i
echo "VITE_API_URL=<ApiUrl output>" > .env.local
npm run dev
```

## Repo map

```
template.yaml              SAM: 2 Lambdas, DynamoDB, HTTP API, Scheduler
backend/src/
  common/                  config, bedrock wrapper, DynamoDB layer, orchestration
  handlers/                api.py (router), scheduled_sitrep.py (0530 cron)
  prompts/                 the actual product: game plan, triage, debrief prompts
frontend/                  React + Vite console: Game Plan / Tasks / Debrief
article/                   Builder Center article draft + architecture diagram
docs/                      deployment, Phase-2 AgentCore plan, compliance checklist
CLAUDE.md                  operating brief for the coding agent
```

Internal identifiers (API routes like `/sitrep/*`, DynamoDB key prefixes, the
CloudFormation stack name) keep the original working name; they are invisible
to users and renaming them buys nothing but risk.

## Phase 2 — AgentCore

The weekend plan migrates orchestration to the newly-GA Amazon Bedrock
AgentCore harness (config-defined agent, managed memory, observability) once
the entry qualifies. Plan and fallback: `docs/PHASE2_AGENTCORE.md`.
