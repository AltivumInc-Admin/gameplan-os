# Deployment Guide

Ordered so nothing blocks on a manual step you discover too late.
Region: **us-east-1** recommended (broadest Bedrock + AgentCore availability).

## 0. Prerequisites

- AWS CLI + SAM CLI configured against the target account
- Node 20+, Python 3.13 locally (for frontend and local tinkering)
- Bedrock **model access enabled** for Amazon Nova models in the console
  (Bedrock → Model access). Do this first; approval is instant for Nova but
  the deploy will 403 without it.

## 1. SES identity (do this FIRST — it has a human-in-the-loop step)

```bash
aws ses verify-email-identity --email-address you@example.com --region us-east-1
```

Click the link SES emails you. Sandbox mode is fine: SITREP sends only to the
same verified address. No production access request needed.

## 2. Verify current Nova model IDs

Model IDs drift; the defaults in template.yaml are parameters, not gospel.

```bash
aws bedrock list-inference-profiles --region us-east-1 \
  --query "inferenceProfileSummaries[?contains(inferenceProfileId,'nova')].inferenceProfileId"
```

Pick the current Pro-class and Lite-class IDs and pass them at deploy time if
they differ from the defaults (`us.amazon.nova-pro-v1:0`, `us.amazon.nova-lite-v1:0`).

## 3. Deploy the backend

First build the agent dependencies layer (vendors the Strands Agents SDK
into `backend/layer/`; the template's `AgentDependenciesLayer` ships it):

```bash
./scripts/build-agent-layer.sh
```

Then deploy:

```bash
sam build
sam deploy --guided
#   Stack name:        sitrep
#   NotifyEmail:       the SES-verified address
#   ApiKey:            a long random string — openssl rand -hex 24
#   NovaProModelId /   from step 2
#   NovaLiteModelId
#   SitrepHourLocal:   "30 5"  (05:30)
#   TimeZone:          America/Chicago
```

Note the `ApiUrl` output.

The stack also creates an SNS topic subscribed to NotifyEmail for the
morning-plan failure alarm — **confirm the SNS subscription email** when it
arrives, or alarm notifications will not be delivered.

## 4. Smoke test (5 minutes, catches 90% of problems)

```bash
API=<ApiUrl>; KEY=<your ApiKey>

curl -s $API/health
curl -s -X POST $API/dump -H "x-sitrep-key: $KEY" -H "content-type: application/json" \
  -d '{"text":"finish the braket cost memo by friday. follow up with APSU pilot. elo onboarding email broken - users cannot verify. record podcast intro. renew SAM cert next month."}'
curl -s $API/tasks?status=open -H "x-sitrep-key: $KEY"
curl -s -X POST $API/sitrep/generate -H "x-sitrep-key: $KEY"
curl -s $API/sitrep/latest -H "x-sitrep-key: $KEY"
curl -s -X POST $API/debrief -H "x-sitrep-key: $KEY" -H "content-type: application/json" \
  -d '{"answers":{"q1":"shipped the memo but it took all morning","q2":"the 0900 block slipped an hour - a call ran long","q3":"i keep underestimating writing tasks"}}'
```

Expected: triage returns discrete scored tasks; the game plan has ONE mission,
time blocks, explicit drops; the debrief returns an honest after-action with
candidate preferences. **If the plan reads like a generic to-do list, stop
and tune `backend/src/prompts/sitrep_prompt.py` — that hour matters more than
any infra work.**

## 5. Test the scheduled path without waiting for 0530

```bash
aws lambda invoke --function-name $(aws cloudformation describe-stack-resources \
  --stack-name sitrep --query "StackResources[?LogicalResourceId=='MorningBriefFunction'].PhysicalResourceId" \
  --output text) --payload '{}' /tmp/out.json && cat /tmp/out.json
```

Check your inbox for the game plan email.

## 6. Frontend on Amplify Hosting (Git-connected CI/CD)

Primary path: connect the GitHub repo to Amplify Hosting. The repo's
`amplify.yml` supplies all build settings (monorepo `frontend/` app root,
Node 20, `npm ci`, `dist` artifacts) automatically. The one setting you must
provide in Amplify is the branch environment variable `VITE_API_URL` set to
the `ApiUrl` stack output — the build fails fast if it is missing. Every push
to `main` then builds and deploys automatically.

Also pass your Amplify domain in the `AllowedOrigins` stack parameter so CORS
admits the deployed frontend.

Fallback (no Git integration): build locally and drag `dist/` into
Amplify console → Host web app → Deploy without Git:

```bash
cd frontend
npm i
echo "VITE_API_URL=<ApiUrl>" > .env.production
npm run build
```

Open the app, enter your ApiKey at the gate, and walk the loop:
dump → tasks → generate → brief → debrief.

## 7. Artifacts for the article (do these while everything is fresh)

- Screenshot: the Brief view with a real order (redact anything sensitive)
- Screenshot: the morning email
- Screenshot: DynamoDB items (PK/SK view showing TASK/SITREP/DEBRIEF/PREF)
- Screenshot: CloudWatch log of one generation (shows the Converse call)
- Optional 60-second screen recording of the full loop

## 8. Optional: the Telegram channel

The agent works in the console with zero extra setup. To also text it:

1. In Telegram, talk to **@BotFather** -> `/newbot` -> copy the token.
2. Generate a webhook secret: `openssl rand -hex 24`.
3. Redeploy with `TelegramBotToken` and `TelegramWebhookSecret` set
   (leave `TelegramChatId` empty for now).
4. Point Telegram at the webhook:

   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=<ApiUrl>/agent/telegram -d secret_token=<SECRET>
   ```

5. Send your bot `/start`. It replies with your chat id because the bot is
   unclaimed. Redeploy once more with `TelegramChatId` set to that id.

From then on the bot answers only you, and the 0530 brief is pushed to the
same chat alongside the email.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 403 AccessDeniedException from Bedrock | Model access not enabled (step 0) or wrong model ID (step 2) |
| ValidationException on modelId | Use an inference-profile ID (`us.` prefix), not a bare model ID |
| SES MessageRejected | Identity not verified, or you changed NotifyEmail after verifying |
| Scheduler never fires | Check the schedule's timezone and that the stack deployed ScheduleV2 (needs recent SAM CLI) |
| JSON parse errors from the model | `converse_json` retries once; if persistent, lower temperature in the failing call |
