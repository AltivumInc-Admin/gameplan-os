"""EventBridge Scheduler target — 0530 local, every day.

Generates the day's game plan and delivers it by email. Idempotent under
Scheduler/Lambda retries: if today's plan already exists (e.g. only the SES
send failed last attempt), it is reused instead of paying for a second
generation. Failures are raised so they land in CloudWatch, the Lambda error
metric, and the failure alarm.
"""
import json

from common import db, service


def handler(_event, _context):
    today = service._local_now().date().isoformat()
    existing = db.get_sitrep(today)
    if existing:
        body = existing["body"]
        print(json.dumps({"event": "morning_brief_reusing_plan", "date": today}))
    else:
        body = service.generate_sitrep()
    service.send_sitrep_email(body)
    print(json.dumps({"event": "morning_brief_delivered", "date": today,
                      "mission": body.get("mission", {}).get("statement")}))
    return {"date": today, "mission": body.get("mission", {}).get("statement")}
