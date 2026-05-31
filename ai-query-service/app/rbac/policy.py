"""Role-based access control policies for ai-query-service.

Roles use the same lowercase canonical names as the backend (Spring AuthorizationPolicyService).
Mapping from previous uppercase aliases:
  CFO          → finance
  ADMIN        → admin
  AREA_MANAGER → region_manager
  OUTLET_MANAGER → outlet_manager

Templates with no entry here are accessible by any authenticated user.
"""
import threading

from app.runtime_catalog import get_runtime_catalog_section

# Canonical role names — kept in sync with backend AuthorizationPolicyService.
_FINANCE = "finance"
_ADMIN = "admin"
_SUPERADMIN = "superadmin"
_REGION_MANAGER = "region_manager"
_OUTLET_MANAGER = "outlet_manager"

# Superadmin matches backend God/other full-access roles — same as admin for finance templates.
_TEMPLATE_FINANCE_SHARED: frozenset[str] = frozenset({_FINANCE, _ADMIN, _SUPERADMIN, _REGION_MANAGER})
_TEMPLATE_PAYROLL_SENSITIVE: frozenset[str] = frozenset({_FINANCE, _ADMIN, _SUPERADMIN})

TEMPLATE_ROLE_RESTRICTIONS: dict[str, frozenset[str]] = {
    "T24_daily_pnl_summary":      _TEMPLATE_FINANCE_SHARED,
    "T25_expense_breakdown":      _TEMPLATE_FINANCE_SHARED,
    "T26_goods_receipt_summary":  _TEMPLATE_FINANCE_SHARED,
    "T27_payroll_cost_by_outlet": _TEMPLATE_PAYROLL_SENSITIVE,
    "INS_FINANCE_DRIVER":         _TEMPLATE_FINANCE_SHARED,
    "ANOM_FINANCE":               _TEMPLATE_FINANCE_SHARED,
    "FORECAST_PROFIT":            _TEMPLATE_FINANCE_SHARED,
}

# Roles that can see ALL outlets (bypass auth.outlet_ids scoping when no specific outlet requested).
GLOBAL_SCOPE_ROLES: frozenset[str] = frozenset({_FINANCE, _ADMIN, _SUPERADMIN})
_RUNTIME_LOCK = threading.RLock()
_RUNTIME_VERSION: int | None = None


def ensure_runtime_template_rbac_loaded(*, force: bool = False) -> None:
    global _RUNTIME_VERSION
    with _RUNTIME_LOCK:
        version, section = get_runtime_catalog_section("template_rbac", force=force)
        if not force and version == _RUNTIME_VERSION:
            return
        if isinstance(section, dict) and isinstance(section.get("template_role_restrictions"), dict):
            parsed: dict[str, frozenset[str]] = {}
            for key, value in section["template_role_restrictions"].items():
                if isinstance(value, (list, tuple, set)):
                    parsed[str(key)] = frozenset(str(x) for x in value)
            if parsed:
                TEMPLATE_ROLE_RESTRICTIONS.clear()
                TEMPLATE_ROLE_RESTRICTIONS.update(parsed)
        _RUNTIME_VERSION = version


def check_template_access(template_key: str, roles: frozenset[str] | set[str]) -> bool:
    ensure_runtime_template_rbac_loaded()
    allowed = TEMPLATE_ROLE_RESTRICTIONS.get(template_key)
    if allowed is None:
        return True
    return bool(set(roles) & allowed)


def has_global_scope(roles: frozenset[str] | set[str]) -> bool:
    return bool(set(roles) & GLOBAL_SCOPE_ROLES)


def compute_allowed_outlets(
    auth_outlet_ids: frozenset[int] | set[int],
    requested_outlet_ids: list[int] | None,
    roles: frozenset[str] | set[str],
    all_outlet_ids_provider=None,
) -> list[int]:
    """Compute final outlet_ids list to inject into SQL.

    Rules:
    - CFO/ADMIN: have global scope; if no specific request, expand to all outlets via provider.
    - Others: scope = auth_outlet_ids.
    - If requested_outlet_ids: intersection with effective scope.
    - Result is always sorted list[int] of unique IDs; never empty (raises ValueError).
    """
    auth_set = set(auth_outlet_ids)

    if has_global_scope(roles):
        if all_outlet_ids_provider is not None:
            scope = set(all_outlet_ids_provider())
        else:
            # Fall back to auth_set if provider not wired
            scope = auth_set
    else:
        scope = auth_set

    if requested_outlet_ids:
        allowed = scope & set(requested_outlet_ids)
    else:
        allowed = scope

    if not allowed:
        raise ValueError("No allowed outlets after RBAC scoping")

    return sorted(allowed)
