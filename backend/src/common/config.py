"""Central configuration pulled from Lambda environment variables."""
import os

TABLE_NAME = os.environ["TABLE_NAME"]
NOTIFY_EMAIL = os.environ["NOTIFY_EMAIL"]
# Only the API function receives API_KEY; the scheduled function imports this
# module too, so resolve leniently here and enforce presence at the auth check.
API_KEY = os.environ.get("API_KEY", "")
NOVA_PRO_MODEL_ID = os.environ.get("NOVA_PRO_MODEL_ID", "us.amazon.nova-pro-v1:0")
NOVA_LITE_MODEL_ID = os.environ.get("NOVA_LITE_MODEL_ID", "us.amazon.nova-lite-v1:0")
USER_ID = os.environ.get("USER_ID", "primary")
LOCAL_TZ = os.environ.get("LOCAL_TZ", "America/Chicago")
# Cognito session auth (empty means JWT auth is off and only the key works).
COGNITO_POOL_ID = os.environ.get("COGNITO_POOL_ID", "")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")
# Telegram channel is optional: empty values disable the webhook and the
# morning push without breaking anything else.
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
TELEGRAM_WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
