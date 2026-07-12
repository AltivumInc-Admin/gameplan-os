"""Cognito JWT verification for the API function.

The API accepts two credentials: a Cognito access token (what the console
uses after sign-in) or the static service key (scripts, smoke tests). JWTs
are verified here in the Lambda rather than with an API Gateway JWT
authorizer because the single ANY /{proxy+} route also carries /health,
CORS preflights, and the Telegram webhook, none of which may require a JWT.

PyJWT + cryptography come from the agent dependencies layer, so this module
is imported lazily by the handler (the scheduled function has no layer).
"""
import json
import time
import urllib.request

from common import config

_jwks_cache: dict = {"keys": None, "fetched": 0.0}
_JWKS_TTL_SECONDS = 3600


def _issuer() -> str:
    return ("https://cognito-idp.us-east-1.amazonaws.com/"
            f"{config.COGNITO_POOL_ID}")


def _jwks() -> dict:
    now = time.time()
    if _jwks_cache["keys"] is None or now - _jwks_cache["fetched"] > _JWKS_TTL_SECONDS:
        with urllib.request.urlopen(
                f"{_issuer()}/.well-known/jwks.json", timeout=5) as resp:
            _jwks_cache["keys"] = json.loads(resp.read())
        _jwks_cache["fetched"] = now
    return _jwks_cache["keys"]


def check_claims(claims: dict, client_id: str) -> bool:
    """Pure claim validation, separated for testing: an access token from
    our pool, for our client. (exp/iss are enforced by the JWT library.)"""
    return (claims.get("token_use") == "access"
            and claims.get("client_id") == client_id)


def verify_bearer(token: str) -> bool:
    """True only for a valid, unexpired access token from our user pool."""
    if not (config.COGNITO_POOL_ID and config.COGNITO_CLIENT_ID and token):
        return False
    import jwt
    from jwt.algorithms import RSAAlgorithm
    try:
        header = jwt.get_unverified_header(token)
        key = next((k for k in _jwks()["keys"] if k["kid"] == header.get("kid")), None)
        if key is None:
            # Key rotation: refresh once, then give up.
            _jwks_cache["keys"] = None
            key = next((k for k in _jwks()["keys"] if k["kid"] == header.get("kid")), None)
            if key is None:
                return False
        public_key = RSAAlgorithm.from_jwk(json.dumps(key))
        claims = jwt.decode(
            token, public_key, algorithms=["RS256"], issuer=_issuer(),
            options={"verify_aud": False})  # access tokens carry client_id, not aud
        return check_claims(claims, config.COGNITO_CLIENT_ID)
    except Exception:
        return False
