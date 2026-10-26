# CLAUDE.md — Operating Brief for Claude Code

## Mission

Ship **Game Plan OS** (formerly SITREP), a personal AI operations officer, as a qualifying entry to the
AWS Builder Center "Build a Productivity App" Weekend Challenge. The challenge
is **pass/fail with a first-50-submissions speed gate**. Deadline: **Sunday
July 13, 2026, 1:00 PM PT (3:00 PM CDT)**. Target: article published **Saturday
morning**. Speed beats polish at the qualifying gate; polish the article, not
the code.

Challenge post: https://builder.aws.com/content/3FXsGsqg6ItccU9Hmr8oG0lPo2z/your-july-weekend-challenge-build-a-productivity-app-get-a-cool-jacket
Terms: https://builder.aws.com/content/3GJsgI65jiG5A6sJLGe5VouAZZ3/aws-builder-center-build-a-productivity-app-weekend-challenge-terms-and-conditions

## Qualifying gates (all three must pass — do not gold-plate past them)

1. **Completeness** — 500+ word Builder Center article covering all required
   sections + working link (live app OR public repo).
2. **Relevance & Functionality** — an AI-powered productivity tool that
   demonstrably works (screenshots/video/live URL).
3. **AWS Service Usage** — at least one AWS service, clearly described.

## What is already decided (do not relitigate)

- **Product**: brain dump → Nova Lite triage → Nova Pro five-paragraph daily
  operations order (one mission, ≤70% scheduling, explicit drops) → evening
  debrief → after-action analysis → high-confidence preferences persist and
  shape tomorrow's brief. The debrief learning loop is the differentiator.
- **Stack (Phase 1)**: SAM, Python 3.13 Lambdas, Bedrock Converse API
  (Nova Pro + Nova Lite), DynamoDB single-table, EventBridge Scheduler
  (05:30 America/Chicago), SES self-email, React+Vite frontend on Amplify
  Hosting, shared-secret header auth (`x-sitrep-key`).
- **Phase 2 (only after the article qualifies)**: migrate orchestration to
  Bedrock AgentCore harness + AgentCore Memory. See docs/PHASE2_AGENTCORE.md.
  If AgentCore fights back for more than ~2 hours, fall back to Strands Agents
  SDK in Lambda and write about the friction honestly — that's article gold.

## Build order

1. `sam build && sam deploy --guided` (see docs/DEPLOYMENT.md — SES identity
   verification FIRST, it has a manual email-click step).
2. Smoke-test with curl (health → dump → tasks → sitrep/generate → debrief).
   Iterate on prompts in `backend/src/prompts/` until the game plan output has
   teeth — decisive mission, real drops, honest overcommitment warnings.
   This is the highest-leverage hour of the project.
3. Frontend: `npm i && npm run dev` against the deployed API, then build and
   deploy to Amplify Hosting.
4. Seed realistic tasks, generate a real game plan, take screenshots (dashboard,
   email, DynamoDB console, one CloudWatch trace).
5. Fill the [TODO] blocks in `article/article-draft.md`, render
   `article/architecture.mmd` to PNG, publish on Builder Center with tag
   `#productivity` and title starting exactly:
   `Weekend Productivity Challenge: Game Plan OS`.
6. Run docs/COMPLIANCE_CHECKLIST.md line by line BEFORE publishing.

## Conventions and guardrails

- **Verify Nova model IDs before deploy** — `aws bedrock list-inference-profiles`.
  IDs are SAM parameters (`NovaProModelId`, `NovaLiteModelId`), not hardcoded.
- Region: use us-east-1 unless there's a reason not to (broadest Bedrock +
  AgentCore availability).
- Account: never rely on the ambient `AWS_PROFILE`; on the owner's machine it
  points at a different account than this stack. SAM takes the pinned profile
  and region from the local, gitignored `samconfig.toml`; pass that same
  `--profile` and `--region us-east-1` on every `aws` CLI call.
- No Cognito, no OAuth, no multi-user, no calendar integration in Phase 1.
  Every one of those is a schedule risk with zero qualifying value.
- Keep JSON-mode discipline: all model calls go through
  `common/bedrock.converse_json` (handles fences + one retry).
- SES sandbox is fine — sender and recipient are the same verified address.
- Errors: fail loudly (CloudWatch), return the real error string in API
  responses during the weekend. This is a personal tool, not a product.
- Commit early, push to a PUBLIC GitHub repo — the repo link alone satisfies
  the "working link" gate if the live URL isn't ready.

## Cut lines (in order, if time runs short)

1. Cut Phase 2 AgentCore migration (article still qualifies without it).
2. Cut the evening debrief UI — keep the API + demo it with curl screenshots.
3. Cut Amplify hosting — public repo + screenshots + 60-second video qualifies.
4. NEVER cut: game plan generation, the article, the compliance checklist.
