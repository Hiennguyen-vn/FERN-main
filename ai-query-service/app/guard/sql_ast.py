from dataclasses import dataclass

import sqlglot
from sqlglot import expressions as exp


ALLOWED_SCHEMAS: frozenset[str] = frozenset({"analytics", "fern"})

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

    # Rule 4: outlet filter must exist
    if not _has_outlet_filter(ast):
        violations.append("Missing outlet_id IN (...) filter")

    # Rule 5: no DDL/DML
    for bad_type in (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter, exp.TruncateTable):
        if any(ast.find_all(bad_type)):
            violations.append(f"DDL/DML not allowed: {bad_type.__name__}")

    return GuardResult(len(violations) == 0, tuple(violations))


def _has_outlet_filter(ast: exp.Expression) -> bool:
    """Verify any WHERE clause contains outlet_id IN (...) hoặc outletId IN (...)"""
    for where in ast.find_all(exp.Where):
        for in_expr in where.find_all(exp.In):
            col = in_expr.this
            if isinstance(col, exp.Column):
                col_name = col.name.lower()
                if col_name in OUTLET_COLUMNS:
                    return True
        # Also accept outlet_id = literal (degenerate single-outlet case)
        for eq in where.find_all(exp.EQ):
            left = eq.left
            if isinstance(left, exp.Column) and left.name.lower() in OUTLET_COLUMNS:
                return True
    return False
