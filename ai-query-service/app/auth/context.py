import hmac
from dataclasses import dataclass, field
from typing import Mapping


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


def parse_auth_headers(
    headers: Mapping[str, str],
    expected_token: str,
) -> AuthContext:
    """
    Parse X-Internal-* headers injected by the Gateway.

    Security contract:
    - X-Internal-Token must match the configured shared secret.
      Comparison is done with hmac.compare_digest to prevent timing attacks.
    - X-Internal-Service must equal "gateway". Any other caller (even with a valid token)
      cannot be trusted to have correctly scoped the user/outlet context, so we reject it
      to prevent a compromised internal service from forging user identity.
    """

    def _get(name: str) -> str:
        for k, v in headers.items():
            if k.lower() == name.lower():
                return v
        return ""

    service_name = _get("X-Internal-Service")
    token = _get("X-Internal-Token")

    # Use constant-time comparison to prevent timing-based oracle attacks.
    # We still check `not token` first because compare_digest requires both
    # strings to be the same type — an empty token is always invalid.
    if not token or not _constant_time_token_equal(token, expected_token):
        raise AuthError(401, "Invalid or missing X-Internal-Token")

    if service_name.lower() != _TRUSTED_CALLER:
        raise AuthError(403, "Request must originate from gateway (X-Internal-Service mismatch)")

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

    return AuthContext(
        user_id=user_id,
        session_id=_get("X-Internal-Session-Id"),
        roles=frozenset(s.strip().lower() for s in _parse_csv_strings(_get("X-Internal-Roles")) if s.strip()),
        permissions=frozenset(_parse_csv_strings(_get("X-Internal-Permissions"))),
        outlet_ids=frozenset(outlet_ids),
        correlation_id=_get("X-Correlation-ID"),
        service_name=service_name,
    )
