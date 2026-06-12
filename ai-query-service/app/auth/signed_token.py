"""Short-lived HMAC-signed internal tokens with jti replay protection.

Token format (JWT-like, stdlib only):
  base64url(header).base64url(payload).base64url(signature)

Header:
  alg  — HS256
  typ  — JWT
  kid  — signing-key id (for rotation)

Payload claims:
  iss     — issuer (must equal configured issuer, typically "gateway")
  sub     — user id (string)
  jti     — unique token id (single-use via Redis SET NX)
  iat     — issued-at (unix seconds)
  exp     — expiry (unix seconds)
  outlets — optional list of outlet ids; when present, must match header scope
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any

import redis

from app.config import get_settings

logger = logging.getLogger(__name__)


class SignedTokenError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class SignedTokenClaims:
    issuer: str
    user_id: int
    jti: str
    issued_at: int
    expires_at: int
    outlet_ids: tuple[int, ...]
    key_id: str


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def looks_like_signed_token(token: str) -> bool:
    """Heuristic: three base64url segments separated by dots."""
    parts = (token or "").split(".")
    return len(parts) == 3 and all(parts)


def _signing_key() -> bytes:
    s = get_settings()
    key = (getattr(s, "internal_token_signing_key", "") or "").strip()
    if not key:
        # Fall back to service token only for dev — production should set signing key.
        key = s.internal_service_token
    return key.encode("utf-8")


def _key_id() -> str:
    s = get_settings()
    return (getattr(s, "internal_token_signing_key_id", "") or "primary").strip() or "primary"


def _verification_keys() -> dict[str, bytes]:
    """Return kid -> key bytes. Includes active signing key by default."""
    s = get_settings()
    out: dict[str, bytes] = {_key_id(): _signing_key()}
    raw = (getattr(s, "internal_token_verify_keys", "") or "").strip()
    if not raw:
        return out
    for part in raw.split(","):
        item = part.strip()
        if not item:
            continue
        kid, sep, key = item.partition(":")
        if not sep:
            continue
        kid = kid.strip()
        key = key.strip()
        if kid and key:
            out[kid] = key.encode("utf-8")
    return out


def issue_signed_token(
    *,
    user_id: int,
    outlet_ids: list[int] | None = None,
    issuer: str | None = None,
    ttl_seconds: int | None = None,
    jti: str | None = None,
) -> str:
    """Issue a signed token (for tests / gateway reference implementation)."""
    s = get_settings()
    now = int(time.time())
    ttl = int(ttl_seconds if ttl_seconds is not None else getattr(s, "internal_token_ttl_seconds", 60))
    payload: dict[str, Any] = {
        "iss": (issuer or getattr(s, "internal_token_issuer", "gateway")).strip(),
        "sub": str(user_id),
        "jti": jti or str(uuid.uuid4()),
        "iat": now,
        "exp": now + max(5, ttl),
    }
    if outlet_ids:
        payload["outlets"] = sorted({int(x) for x in outlet_ids})

    header = {"alg": "HS256", "typ": "JWT", "kid": _key_id()}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{payload_b64}".encode()
    sig = hmac.new(_signing_key(), signing_input, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url_encode(sig)}"


def _parse_claims(payload: dict[str, Any], *, key_id: str) -> SignedTokenClaims:
    s = get_settings()
    issuer = str(payload.get("iss") or "").strip()
    expected_issuer = getattr(s, "internal_token_issuer", "gateway").strip()
    if issuer != expected_issuer:
        raise SignedTokenError(401, "Invalid token issuer")

    try:
        user_id = int(str(payload.get("sub") or ""))
    except ValueError:
        raise SignedTokenError(401, "Invalid token subject") from None

    jti = str(payload.get("jti") or "").strip()
    if not jti:
        raise SignedTokenError(401, "Missing jti")

    try:
        issued_at = int(payload.get("iat"))
        expires_at = int(payload.get("exp"))
    except (TypeError, ValueError):
        raise SignedTokenError(401, "Invalid token timestamps") from None

    now = int(time.time())
    if expires_at < now:
        raise SignedTokenError(401, "Token expired")
    if issued_at > now + 30:
        raise SignedTokenError(401, "Token not yet valid")

    outlets_raw = payload.get("outlets") or []
    outlets: tuple[int, ...] = ()
    if isinstance(outlets_raw, list):
        try:
            outlets = tuple(sorted({int(x) for x in outlets_raw}))
        except (TypeError, ValueError):
            raise SignedTokenError(400, "Invalid outlets in token") from None

    return SignedTokenClaims(
        issuer=issuer,
        user_id=user_id,
        jti=jti,
        issued_at=issued_at,
        expires_at=expires_at,
        outlet_ids=outlets,
        key_id=key_id,
    )


def assert_claim_outlets_match_headers(claims: SignedTokenClaims, header_outlet_ids: list[int]) -> None:
    """Bind signed token scope to the gateway-provided outlet header.

    If the token carries an `outlets` claim, require exact set equality with
    `X-Internal-Outlet-Ids`. This prevents a signed token for one outlet scope
    from being replayed with a broadened/narrowed header scope.
    """
    if not claims.outlet_ids:
        return
    header_scope = tuple(sorted({int(x) for x in header_outlet_ids}))
    if claims.outlet_ids != header_scope:
        raise SignedTokenError(401, "Token outlet scope does not match X-Internal-Outlet-Ids")


def verify_signed_token(token: str, *, redis_client: redis.Redis | None = None) -> SignedTokenClaims:
    if not looks_like_signed_token(token):
        raise SignedTokenError(401, "Malformed signed token")

    header_b64, payload_b64, sig_b64 = token.split(".", 2)
    signing_input = f"{header_b64}.{payload_b64}".encode()
    try:
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
    except (json.JSONDecodeError, ValueError):
        raise SignedTokenError(401, "Invalid token payload") from None

    if header.get("alg") != "HS256":
        raise SignedTokenError(401, "Unsupported token algorithm")
    key_id = str(header.get("kid") or "").strip() or _key_id()

    try:
        actual_sig = _b64url_decode(sig_b64)
    except Exception:
        raise SignedTokenError(401, "Invalid token signature encoding") from None

    verify_keys = _verification_keys()
    verify_key = verify_keys.get(key_id)
    if verify_key is None:
        raise SignedTokenError(401, "Unknown token key id")
    expected_sig = hmac.new(verify_key, signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(actual_sig, expected_sig):
        raise SignedTokenError(401, "Invalid token signature")

    claims = _parse_claims(payload, key_id=key_id)

    if redis_client is not None:
        ttl = max(1, claims.expires_at - int(time.time()))
        key = f"internal:jti:{claims.jti}"
        try:
            # SET NX — reject replay within token lifetime.
            if not redis_client.set(key, "1", nx=True, ex=ttl):
                raise SignedTokenError(401, "Token replay detected")
        except SignedTokenError:
            raise
        except (redis.ConnectionError, redis.TimeoutError, redis.RedisError) as e:
            s = get_settings()
            policy = getattr(s, "internal_token_replay_redis_policy", "fail_closed").lower()
            if policy == "fail_open":
                logger.warning("jti store unavailable, fail-open: %s", e)
            else:
                raise SignedTokenError(503, "Auth replay store unavailable") from e

    return claims
