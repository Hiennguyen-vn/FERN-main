import pytest

from app.auth.context import AuthError, parse_auth_headers


VALID_TOKEN = "secret-123"


def _h(**kwargs):
    return {f"X-Internal-{k}": v for k, v in kwargs.items()}


def test_parse_valid_headers():
    headers = {
        "X-Internal-Service": "gateway",
        "X-Internal-Token": VALID_TOKEN,
        "X-Internal-User-Id": "42",
        "X-Internal-Session-Id": "sess-abc",
        "X-Internal-Roles": "STORE_MANAGER,CASHIER",
        "X-Internal-Permissions": "sales:read,inventory:read",
        "X-Internal-Outlet-Ids": "1,2,5",
        "X-Correlation-ID": "corr-xyz",
    }
    ctx = parse_auth_headers(headers, VALID_TOKEN)
    assert ctx.user_id == 42
    assert ctx.session_id == "sess-abc"
    assert ctx.roles == frozenset({"STORE_MANAGER", "CASHIER"})
    assert ctx.outlet_ids == frozenset({1, 2, 5})
    assert ctx.correlation_id == "corr-xyz"
    assert not ctx.is_cfo_or_admin


def test_cfo_role():
    headers = {
        "X-Internal-Token": VALID_TOKEN,
        "X-Internal-User-Id": "1",
        "X-Internal-Roles": "CFO",
        "X-Internal-Outlet-Ids": "1",
    }
    ctx = parse_auth_headers(headers, VALID_TOKEN)
    assert ctx.is_cfo_or_admin


def test_missing_token_rejected():
    with pytest.raises(AuthError) as exc:
        parse_auth_headers({"X-Internal-User-Id": "1"}, VALID_TOKEN)
    assert exc.value.status_code == 401


def test_wrong_token_rejected():
    headers = {"X-Internal-Token": "wrong", "X-Internal-User-Id": "1"}
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 401


def test_missing_user_id_rejected():
    headers = {"X-Internal-Token": VALID_TOKEN}
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 401


def test_empty_outlet_scope_rejected():
    headers = {
        "X-Internal-Token": VALID_TOKEN,
        "X-Internal-User-Id": "42",
        "X-Internal-Outlet-Ids": "",
    }
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 403


def test_invalid_outlet_id_rejected():
    headers = {
        "X-Internal-Token": VALID_TOKEN,
        "X-Internal-User-Id": "42",
        "X-Internal-Outlet-Ids": "1,abc,3",
    }
    with pytest.raises(AuthError) as exc:
        parse_auth_headers(headers, VALID_TOKEN)
    assert exc.value.status_code == 400


def test_case_insensitive_headers():
    headers = {
        "x-internal-token": VALID_TOKEN,
        "x-internal-user-id": "7",
        "x-internal-outlet-ids": "1",
    }
    ctx = parse_auth_headers(headers, VALID_TOKEN)
    assert ctx.user_id == 7
