"""Role-based access control policies for ai-query-service.

Templates restricted to higher roles. Default = no restriction (any authenticated user).
"""

TEMPLATE_ROLE_RESTRICTIONS: dict[str, frozenset[str]] = {
    "T24_daily_pnl_summary":      frozenset({"CFO", "ADMIN", "AREA_MANAGER"}),
    "T25_expense_breakdown":      frozenset({"CFO", "ADMIN", "AREA_MANAGER"}),
    "T26_goods_receipt_summary":  frozenset({"CFO", "ADMIN", "AREA_MANAGER"}),
    "T27_payroll_cost_by_outlet": frozenset({"CFO", "ADMIN"}),
}

# Roles that can see ALL outlets (bypass auth.outlet_ids scoping when no specific outlet requested)
GLOBAL_SCOPE_ROLES: frozenset[str] = frozenset({"CFO", "ADMIN"})


def check_template_access(template_key: str, roles: frozenset[str] | set[str]) -> bool:
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
