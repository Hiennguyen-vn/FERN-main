from dataclasses import dataclass

import sqlglot
from sqlglot import expressions as exp


ALLOWED_SCHEMAS: frozenset[str] = frozenset({"analytics", "fern", "cdc"})

BLOCKED_FUNCTIONS: frozenset[str] = frozenset({
    "system", "file", "url", "remote", "remotesecure", "cluster", "clusterallreplicas",
    "jdbc", "odbc", "postgresql", "mysql", "mongodb", "executable", "s3", "hdfs",
    "input", "merge",
})

OUTLET_COLUMNS: frozenset[str] = frozenset({"outlet_id", "outletid"})


@dataclass(frozen=True)
class GuardResult:
    passed: bool
    violations: tuple[str, ...]


def validate_sql(sql: str) -> GuardResult:
    violations: list[str] = []

    try:
        statements = sqlglot.parse(sql, dialect="clickhouse")
    except Exception as e:
        return GuardResult(False, (f"Parse error: {e}",))

    if not statements or len(statements) != 1:
        return GuardResult(False, (f"Expected exactly 1 statement, got {len(statements or [])}",))

    ast = statements[0]
    if ast is None:
        return GuardResult(False, ("Empty statement",))

    # Rule 1: SELECT only
    if not isinstance(ast, (exp.Select, exp.Subquery, exp.Union)):
        return GuardResult(False, (f"Only SELECT allowed, got {type(ast).__name__}",))

    # Reject UNION (bypass risk)
    if isinstance(ast, exp.Union) or any(ast.find_all(exp.Union)):
        violations.append("UNION not allowed")

    # Rule 2: schema whitelist
    for table in ast.find_all(exp.Table):
        db = table.db or ""
        if db and db.lower() not in ALLOWED_SCHEMAS:
            violations.append(f"Schema not allowed: {db}.{table.name}")
        elif not db:
            violations.append(f"Table without schema qualifier: {table.name}")

    # Rule 3: blocked functions
    for func in ast.find_all(exp.Anonymous):
        name = (func.this or "").lower() if isinstance(func.this, str) else getattr(func.this, "name", "").lower()
        if name in BLOCKED_FUNCTIONS:
            violations.append(f"Blocked function: {name}")

    for func in ast.find_all(exp.Func):
        name = func.sql_name().lower() if hasattr(func, "sql_name") else ""
        if name in BLOCKED_FUNCTIONS:
            violations.append(f"Blocked function: {name}")

    # Rule 4a: the outermost query must have an outlet_id predicate.
    if not _outer_has_outlet_filter(ast):
        violations.append("Missing outlet_id IN (...) filter")

    # Rule 4b: every nested SELECT that directly reads a scoped schema must also have its own
    # outlet_id predicate. This blocks unfiltered scalar subqueries / derived tables that would
    # leak global aggregates even when the outer WHERE has outlet_id IN (...).
    violations.extend(_validate_subquery_scoping(ast))

    # Rule 5: no DDL/DML
    for bad_type in (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter, exp.TruncateTable):
        if any(ast.find_all(bad_type)):
            violations.append(f"DDL/DML not allowed: {bad_type.__name__}")

    return GuardResult(len(violations) == 0, tuple(violations))


# ── Tenant isolation helpers ──────────────────────────────────────────────────

def _outer_has_outlet_filter(ast: exp.Expression) -> bool:
    """
    Check the outermost WHERE clause (anywhere in the top-level expression tree)
    contains outlet_id IN (...) or outlet_id = <literal>.
    """
    for where in ast.find_all(exp.Where):
        if _where_has_outlet_filter(where):
            return True
    return False


def _validate_subquery_scoping(ast: exp.Expression) -> list[str]:
    """
    Walk every Subquery node in the AST. Any subquery whose SELECT directly reads
    from a scoped schema (analytics.*, fern.*, cdc.*) and lacks its own outlet_id
    WHERE predicate is a tenant isolation violation — it can aggregate global data
    and surface it through the outer query even when the outer WHERE is scoped.
    """
    violations: list[str] = []
    for subquery in ast.find_all(exp.Subquery):
        inner = subquery.find(exp.Select)
        if inner is None:
            continue
        scoped = _direct_scoped_tables_via_walk(inner)
        if not scoped:
            continue
        where = inner.find(exp.Where)
        if where is None or not _where_has_outlet_filter(where):
            violations.append(
                f"Unscoped subquery reads {scoped} without outlet_id filter"
            )
    return violations


def _direct_scoped_tables_via_walk(select: exp.Select) -> list[str]:
    """
    Collect scoped table names directly referenced in this SELECT's FROM/JOIN.
    Uses iter_expressions() to avoid args-dict coupling with sqlglot internals,
    and stops descent at any nested Subquery boundary.
    """
    result: list[str] = []

    def _walk(node: exp.Expression) -> None:
        if isinstance(node, exp.Subquery):
            return
        if isinstance(node, exp.Table):
            db = (node.db or "").lower()
            if db in ALLOWED_SCHEMAS:
                result.append(f"{db}.{node.name}")
            return
        for child in node.iter_expressions():
            _walk(child)

    from_node = select.args.get("from")
    if from_node:
        _walk(from_node)
    for join in (select.args.get("joins") or []):
        _walk(join)

    return result


def _where_has_outlet_filter(where: exp.Where) -> bool:
    """Return True if this WHERE contains outlet_id IN (...) or outlet_id = <literal>."""
    for in_expr in where.find_all(exp.In):
        col = in_expr.this
        if isinstance(col, exp.Column) and col.name.lower() in OUTLET_COLUMNS:
            return True
    for eq in where.find_all(exp.EQ):
        left = eq.left
        if isinstance(left, exp.Column) and left.name.lower() in OUTLET_COLUMNS:
            return True
    return False
