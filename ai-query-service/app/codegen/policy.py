"""Table-level RBAC for codegen (finance-sensitive facts)."""

from app.rbac.policy import TEMPLATE_ROLE_RESTRICTIONS, ensure_runtime_template_rbac_loaded
from app.query_policy import finance_sensitive_tables

def _finance_sensitive_tables() -> frozenset[str]:
    return finance_sensitive_tables()


def finance_roles_required() -> frozenset[str]:
    """Union of roles allowed to touch any finance-only template."""
    ensure_runtime_template_rbac_loaded()
    roles: set[str] = set()
    for key in ("T24_daily_pnl_summary", "T25_expense_breakdown", "T26_goods_receipt_summary", "T27_payroll_cost_by_outlet"):
        roles |= set(TEMPLATE_ROLE_RESTRICTIONS.get(key, frozenset()))
    return frozenset(roles)


def check_codegen_finance_access(tables_lower: frozenset[str], roles: frozenset[str] | set[str]) -> tuple[bool, str | None]:
    hit = tables_lower & _finance_sensitive_tables()
    if not hit:
        return True, None
    allowed = finance_roles_required()
    if set(roles) & allowed:
        return True, None
    return False, f"Role insufficient for finance tables: {sorted(hit)}"
