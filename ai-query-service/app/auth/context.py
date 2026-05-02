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
        return "ADMIN" in self.roles

    @property
    def is_cfo_or_admin(self) -> bool:
        return bool(self.roles & {"CFO", "ADMIN"})


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


def parse_auth_headers(
    headers: Mapping[str, str],
    expected_token: str,
) -> AuthContext:
    """Parse X-Internal-* headers từ Gateway. Verify shared secret token."""

    def _get(name: str) -> str:
        for k, v in headers.items():
            if k.lower() == name.lower():
                return v
        return ""

    service_name = _get("X-Internal-Service")
    token = _get("X-Internal-Token")

    if not token or token != expected_token:
        raise AuthError(401, "Invalid or missing X-Internal-Token")

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
        roles=frozenset(_parse_csv_strings(_get("X-Internal-Roles"))),
        permissions=frozenset(_parse_csv_strings(_get("X-Internal-Permissions"))),
        outlet_ids=frozenset(outlet_ids),
        correlation_id=_get("X-Correlation-ID"),
        service_name=service_name,
    )
