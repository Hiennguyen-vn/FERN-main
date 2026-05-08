"""SQL guard graph node — wraps app.guard.sql_ast.validate_sql."""
from app.graph.state import GraphState
from app.guard.sql_ast import validate_sql


def sql_guard(state: GraphState) -> GraphState:
    sql = state.get("corrected_sql") or state.get("final_sql")
    if not sql:
        state["guard_passed"] = False
        state["guard_violations"] = ["No SQL to validate"]
        state.setdefault("trace", []).append({"node": "sql_guard", "passed": False})
        return state

    allowed = state.get("guard_allowed_tables")
    allowed_tables = frozenset(allowed) if isinstance(allowed, list) else None
    result = validate_sql(sql, allowed_tables=allowed_tables)
    state["guard_passed"] = result.passed
    state["guard_violations"] = list(result.violations)
    state.setdefault("trace", []).append({"node": "sql_guard", "passed": result.passed})
    return state
