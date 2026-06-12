import time
import base64
import hashlib
import hmac
import json

import pytest

from app.auth.context import AuthError, parse_auth_headers
from app.auth.signed_token import SignedTokenError, issue_signed_token, verify_signed_token


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True


def _gateway_headers(**extra):
    return {"X-Internal-Service": "gateway", **extra}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _build_token(*, kid: str, key: str, user_id: int = 7, outlet_ids=None):
    now = int(time.time())
    payload = {
        "iss": "gateway",
        "sub": str(user_id),
        "jti": f"jti-{kid}",
        "iat": now,
        "exp": now + 60,
    }
    if outlet_ids is not None:
        payload["outlets"] = outlet_ids
    header = {"alg": "HS256", "typ": "JWT", "kid": kid}
    header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(key.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url(sig)}"


def test_issue_and_verify_signed_token(monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY", "test-signing-key")
    from app.config import get_settings

    get_settings.cache_clear()

    token = issue_signed_token(user_id=42, outlet_ids=[1, 2], ttl_seconds=60)
    claims = verify_signed_token(token, redis_client=FakeRedis())
    assert claims.user_id == 42
    assert claims.outlet_ids == (1, 2)


def test_expired_token_rejected(monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY", "test-signing-key")
    from app.config import get_settings

    get_settings.cache_clear()

    t0 = int(time.time())
    monkeypatch.setattr("app.auth.signed_token.time.time", lambda: t0)
    token = issue_signed_token(user_id=1, ttl_seconds=60)
    monkeypatch.setattr("app.auth.signed_token.time.time", lambda: t0 + 120)
    with pytest.raises(SignedTokenError) as exc:
        verify_signed_token(token, redis_client=FakeRedis())
    assert exc.value.status_code == 401


def test_reused_jti_rejected(monkeypatch):
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY", "test-signing-key")
    from app.config import get_settings

    get_settings.cache_clear()

    redis = FakeRedis()
    token = issue_signed_token(user_id=1, jti="fixed-jti", ttl_seconds=60)
    verify_signed_token(token, redis_client=redis)
    with pytest.raises(SignedTokenError) as exc:
        verify_signed_token(token, redis_client=redis)
    assert "replay" in exc.value.message.lower()


def test_parse_auth_headers_signed_mode(monkeypatch):
    monkeypatch.setenv("INTERNAL_AUTH_MODE", "signed")
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY", "test-signing-key")
    from app.config import get_settings

    get_settings.cache_clear()

    token = issue_signed_token(user_id=7, ttl_seconds=60)
    headers = _gateway_headers(
        **{
            "X-Internal-Token": token,
            "X-Internal-User-Id": "7",
            "X-Internal-Outlet-Ids": "1,2",
        }
    )
    ctx = parse_auth_headers(headers, "unused-static", redis_client=FakeRedis())
    assert ctx.user_id == 7
    assert ctx.auth_method == "signed"


def test_parse_auth_headers_both_mode_static_still_works(monkeypatch):
    monkeypatch.setenv("INTERNAL_AUTH_MODE", "both")
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "secret-123")
    from app.config import get_settings

    get_settings.cache_clear()

    headers = _gateway_headers(
        **{
            "X-Internal-Token": "secret-123",
            "X-Internal-User-Id": "7",
            "X-Internal-Outlet-Ids": "1",
        }
    )
    ctx = parse_auth_headers(headers, "secret-123", redis_client=None)
    assert ctx.auth_method == "static"


def test_signed_token_outlet_scope_mismatch_rejected(monkeypatch):
    monkeypatch.setenv("INTERNAL_AUTH_MODE", "signed")
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY", "test-signing-key")
    from app.config import get_settings

    get_settings.cache_clear()

    token = issue_signed_token(user_id=7, outlet_ids=[1], ttl_seconds=60)
    headers = _gateway_headers(
        **{
            "X-Internal-Token": token,
            "X-Internal-User-Id": "7",
            "X-Internal-Outlet-Ids": "1,2",
        }
    )
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, "unused-static", redis_client=FakeRedis())
    assert exc.value.status_code == 401


def test_signed_token_kid_rotation_accepts_secondary_key(monkeypatch):
    monkeypatch.setenv("INTERNAL_AUTH_MODE", "signed")
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY", "primary-key")
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY_ID", "primary")
    monkeypatch.setenv("INTERNAL_TOKEN_VERIFY_KEYS", "primary:primary-key,old:old-key")
    from app.config import get_settings

    get_settings.cache_clear()
    token = issue_signed_token(user_id=7, ttl_seconds=60, jti="kid-rotation")
    # Token should validate with active key ring and correct headers.
    headers = _gateway_headers(
        **{
            "X-Internal-Token": token,
            "X-Internal-User-Id": "7",
            "X-Internal-Outlet-Ids": "1",
        }
    )
    ctx = parse_auth_headers(headers, "unused-static", redis_client=FakeRedis())
    assert ctx.auth_method == "signed"


def test_signed_token_verifies_old_kid_from_ring(monkeypatch):
    monkeypatch.setenv("INTERNAL_AUTH_MODE", "signed")
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY", "primary-key")
    monkeypatch.setenv("INTERNAL_TOKEN_SIGNING_KEY_ID", "primary")
    monkeypatch.setenv("INTERNAL_TOKEN_VERIFY_KEYS", "primary:primary-key,old:old-key")
    from app.config import get_settings

    get_settings.cache_clear()
    token = _build_token(kid="old", key="old-key", outlet_ids=[1])
    headers = _gateway_headers(
        **{
            "X-Internal-Token": token,
            "X-Internal-User-Id": "7",
            "X-Internal-Outlet-Ids": "1",
        }
    )
    ctx = parse_auth_headers(headers, "unused-static", redis_client=FakeRedis())
    assert ctx.auth_method == "signed"
