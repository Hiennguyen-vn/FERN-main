import pytest

from app.auth.context import AuthError, parse_auth_headers
from app.config import get_settings


VALID_TOKEN = "secret-123"


@pytest.fixture(autouse=True)
def _reset_settings_cache(monkeypatch):
    monkeypatch.delenv("INTERNAL_AUTH_MODE", raising=False)
    monkeypatch.delenv("INTERNAL_TOKEN_SIGNING_KEY", raising=False)
    monkeypatch.delenv("INTERNAL_TOKEN_SIGNING_KEY_ID", raising=False)
    monkeypatch.delenv("INTERNAL_TOKEN_VERIFY_KEYS", raising=False)
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", VALID_TOKEN)
    get_settings.cache_clear()


def _h(**kwargs):
    return {f"X-Internal-{k}": v for k, v in kwargs.items()}


def _gateway_headers(**extra) -> dict:
    """Build headers that satisfy the gateway-caller enforcement."""
    return {"X-Internal-Service": "gateway", "X-Internal-Token": VALID_TOKEN, **extra}


def test_parse_valid_headers():
    headers = _gateway_headers(**{
        "X-Internal-User-Id": "42",
        "X-Internal-Session-Id": "sess-abc",
        "X-Internal-Roles": "outlet_manager,cashier",
        "X-Internal-Permissions": "sales:read,inventory:read",
        "X-Internal-Outlet-Ids": "1,2,5",
        "X-Correlation-ID": "corr-xyz",
    })
    ctx = parse_auth_headers(headers, VALID_TOKEN)
    assert ctx.user_id == 42
    assert ctx.session_id == "sess-abc"
    assert ctx.roles == frozenset({"outlet_manager", "cashier"})
    assert ctx.outlet_ids == frozenset({1, 2, 5})
    assert ctx.correlation_id == "corr-xyz"
    assert not ctx.is_finance_or_admin


def test_finance_role():
    headers = _gateway_headers(**{
        "X-Internal-User-Id": "1",
        "X-Internal-Roles": "finance",
        "X-Internal-Outlet-Ids": "1",
    })
    ctx = parse_auth_headers(headers, VALID_TOKEN)
    assert ctx.is_finance_or_admin


def test_non_gateway_caller_rejected():
    """Any caller other than gateway must be rejected even with a valid token."""
    headers = {
        "X-Internal-Service": "reporting-service",
        "X-Internal-Token": VALID_TOKEN,
        "X-Internal-User-Id": "1",
        "X-Internal-Outlet-Ids": "1",
    }
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 403


def test_missing_service_header_rejected():
    """No X-Internal-Service header means caller is not gateway."""
    headers = {
        "X-Internal-Token": VALID_TOKEN,
        "X-Internal-User-Id": "1",
        "X-Internal-Outlet-Ids": "1",
    }
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 403


def test_missing_token_rejected():
    with pytest.raises(AuthError) as exc:
        parse_auth_headers({"X-Internal-Service": "gateway", "X-Internal-User-Id": "1"}, VALID_TOKEN)
    assert exc.value.status_code == 401


def test_wrong_token_rejected():
    headers = {"X-Internal-Service": "gateway", "X-Internal-Token": "wrong", "X-Internal-User-Id": "1"}
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 401


def test_missing_user_id_rejected():
    headers = _gateway_headers(**{"X-Internal-User-Id": "", "X-Internal-Outlet-Ids": "1"})
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 401


def test_empty_outlet_scope_rejected():
    headers = _gateway_headers(**{
        "X-Internal-User-Id": "42",
        "X-Internal-Outlet-Ids": "",
    })
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 403


def test_invalid_outlet_id_rejected():
    headers = _gateway_headers(**{
        "X-Internal-User-Id": "42",
        "X-Internal-Outlet-Ids": "1,abc,3",
    })
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 400


def test_case_insensitive_headers():
    headers = {
        "x-internal-service": "gateway",
        "x-internal-token": VALID_TOKEN,
        "x-internal-user-id": "7",
        "x-internal-outlet-ids": "1",
    }
    ctx = parse_auth_headers(headers, VALID_TOKEN)
    assert ctx.user_id == 7
