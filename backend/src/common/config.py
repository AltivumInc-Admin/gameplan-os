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
