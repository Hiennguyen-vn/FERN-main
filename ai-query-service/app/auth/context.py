import hmac
from dataclasses import dataclass
from typing import Mapping

import redis

from app.auth.signed_token import (
    SignedTokenClaims,
    SignedTokenError,
    assert_claim_outlets_match_headers,
    looks_like_signed_token,
    verify_signed_token,
)
from app.config import get_settings


class AuthError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class AuthContext:
    user_id: int
    session_id: str
    roles: frozenset[str]
    permissions: frozenset[str]
    outlet_ids: frozenset[int]
    correlation_id: str = ""
    service_name: str = ""
    auth_method: str = "static"

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles

    @property
    def is_finance_or_admin(self) -> bool:
        """True for roles with cross-outlet financial read access (finance, admin, superadmin)."""
        return bool(self.roles & {"finance", "admin", "superadmin"})


def _parse_csv_ints(value: str) -> list[int]:
    if not value:
        return []
    out = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            raise AuthError(400, f"Invalid integer in CSV header: {part!r}")
    return out


def _parse_csv_strings(value: str) -> list[str]:
    if not value:
        return []
    return [p.strip() for p in value.split(",") if p.strip()]


_TRUSTED_CALLER = "gateway"


def _constant_time_token_equal(a: str, b: str) -> bool:
    """Timing-safe string comparison to prevent timing-based token oracle attacks."""
    return hmac.compare_digest(
        a.encode("utf-8", errors="replace"),
        b.encode("utf-8", errors="replace"),
    )


def _verify_internal_token(
    token: str,
    expected_token: str,
    *,
    redis_client: redis.Redis | None,
) -> tuple[str, SignedTokenClaims | None]:
    """Return (auth_method, signed_claims_if_any)."""
    s = get_settings()
    mode = s.internal_auth_mode

    if mode == "signed":
        try:
            return "signed", verify_signed_token(token, redis_client=redis_client)
        except SignedTokenError as e:
            raise AuthError(e.status_code, e.message) from e

    if mode == "both" and looks_like_signed_token(token):
        try:
            return "signed", verify_signed_token(token, redis_client=redis_client)
        except SignedTokenError:
            # Fall through to static compare for migration window.
            pass

    if not token or not _constant_time_token_equal(token, expected_token):
        raise AuthError(401, "Invalid or missing X-Internal-Token")
    return "static", None


def parse_auth_headers(
    headers: Mapping[str, str],
    expected_token: str,
    *,
    redis_client: redis.Redis | None = None,
) -> AuthContext:
    """
    Parse X-Internal-* headers injected by the Gateway.

    Security contract:
    - X-Internal-Token: static shared secret (legacy) OR short-lived signed token.
    - X-Internal-Service must equal "gateway".
    - X-Internal-Outlet-Ids must be non-empty (tenant scope from Gateway).
    """

    def _get(name: str) -> str:
        for k, v in headers.items():
            if k.lower() == name.lower():
                return v
        return ""

    service_name = _get("X-Internal-Service")
    token = _get("X-Internal-Token")

    if service_name.lower() != _TRUSTED_CALLER:
        raise AuthError(403, "Request must originate from gateway (X-Internal-Service mismatch)")

    auth_method, signed_claims = _verify_internal_token(token, expected_token, redis_client=redis_client)

    user_id_raw = _get("X-Internal-User-Id")
    if not user_id_raw:
        raise AuthError(401, "Missing X-Internal-User-Id")

    try:
        user_id = int(user_id_raw)
    except ValueError:
        raise AuthError(400, "X-Internal-User-Id must be integer")

    outlet_ids = _parse_csv_ints(_get("X-Internal-Outlet-Ids"))
    if not outlet_ids:
        raise AuthError(403, "No outlet scope (X-Internal-Outlet-Ids empty)")

    if auth_method == "signed" and signed_claims is not None:
        if signed_claims.user_id != user_id:
            raise AuthError(401, "Token subject does not match X-Internal-User-Id")
        try:
            assert_claim_outlets_match_headers(signed_claims, outlet_ids)
        except SignedTokenError as e:
            raise AuthError(e.status_code, e.message) from e

    return AuthContext(
        user_id=user_id,
        session_id=_get("X-Internal-Session-Id"),
        roles=frozenset(s.strip().lower() for s in _parse_csv_strings(_get("X-Internal-Roles")) if s.strip()),
        permissions=frozenset(_parse_csv_strings(_get("X-Internal-Permissions"))),
        outlet_ids=frozenset(outlet_ids),
        correlation_id=_get("X-Correlation-ID"),
        service_name=service_name,
        auth_method=auth_method,
    )
