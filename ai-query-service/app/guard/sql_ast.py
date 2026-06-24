from dataclasses import dataclass
from datetime import date, timedelta
import re

import sqlglot
from sqlglot import expressions as exp

from app.query_policy import ALLOWED_SCHEMAS
from app.query_policy.policy import (
    LOOKUP_SUBQUERY_TABLES_OK_WITHOUT_LOCAL_OUTLET,
    TABLE_BLOCKED_SELECT_COLUMNS,
    TABLE_TIME_COLUMNS,
)
from app.time_utils import today_local

BLOCKED_FUNCTIONS: frozenset[str] = frozenset({
    "system", "file", "url", "remote", "remotesecure", "cluster", "clusterallreplicas",
    "jdbc", "odbc", "postgresql", "mysql", "mongodb", "executable", "s3", "hdfs",
    "input", "merge",
})

OUTLET_COLUMNS: frozenset[str] = frozenset({"outlet_id", "outletid"})

# Dimension / bridge lookups joined under an outer scoped fact — outlet enforced outside.
_LOOKUP_SUBQUERY_TABLES_OK_WITHOUT_LOCAL_OUTLET: frozenset[str] = LOOKUP_SUBQUERY_TABLES_OK_WITHOUT_LOCAL_OUTLET


@dataclass(frozen=True)
class GuardResult:
    passed: bool
    violations: tuple[str, ...]


def extract_qualified_table_names(ast: exp.Expression) -> frozenset[str]:
    """Lowercase `db.table` names referenced anywhere in the AST."""
    found: set[str] = set()
    for table in ast.find_all(exp.Table):
        db = str(table.db or "").lower()
        name = str(table.name or "").lower()
        if db and name:
            found.add(f"{db}.{name}")
    return frozenset(found)


def validate_sql_phase1(
    sql: str,
    *,
    allowed_tables: frozenset[str],
    require_time_filter_tables: frozenset[str] | None = None,
) -> GuardResult:
    """
    GenSQL pre-RBAC gate: structure + allow-listed tables only.
    Does not enforce outlet isolation — run validate_sql() after programmatic RBAC inject.
    """
    violations: list[str] = []

    violations.extend(_validate_raw_sql_safety(sql))

    try:
        statements = sqlglot.parse(sql, dialect="clickhouse")
    except Exception as e:
        return GuardResult(False, (f"Parse error: {e}",))

    if not statements or len(statements) != 1:
        return GuardResult(False, (f"Expected exactly 1 statement, got {len(statements or [])}",))

    ast = statements[0]
    if ast is None:
        return GuardResult(False, ("Empty statement",))

    if not isinstance(ast, (exp.Select, exp.Subquery, exp.Union)):
        return GuardResult(False, (f"Only SELECT allowed, got {type(ast).__name__}",))

    if isinstance(ast, exp.Union) or any(ast.find_all(exp.Union)):
        violations.append("UNION not allowed")

    if any(ast.find_all(exp.With)):
        violations.append("WITH/CTE not allowed for GenSQL")

    violations.extend(_validate_projection_safety(ast))

    for table in ast.find_all(exp.Table):
        db = str(table.db or "").lower()
        if db and db not in ALLOWED_SCHEMAS:
            violations.append(f"Schema not allowed: {db}.{table.name}")
        elif not db:
            violations.append(f"Table without schema qualifier: {table.name}")

    qtables = extract_qualified_table_names(ast)
    bad = sorted(t for t in qtables if t not in allowed_tables)
    if bad:
        violations.append(f"Disallowed table(s): {bad}")

    if require_time_filter_tables:
        violations.extend(_validate_required_time_filters(ast, require_time_filter_tables))

    violations.extend(_validate_future_date_bounds(sql))

    for func in ast.find_all(exp.Anonymous):
        name = (func.this or "").lower() if isinstance(func.this, str) else getattr(func.this, "name", "").lower()
        if name in BLOCKED_FUNCTIONS:
            violations.append(f"Blocked function: {name}")

    for func in ast.find_all(exp.Func):
        name = func.sql_name().lower() if hasattr(func, "sql_name") else ""
        if name in BLOCKED_FUNCTIONS:
            violations.append(f"Blocked function: {name}")

    for bad_type in (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter, exp.TruncateTable):
        if any(ast.find_all(bad_type)):
            violations.append(f"DDL/DML not allowed: {bad_type.__name__}")

    return GuardResult(len(violations) == 0, tuple(violations))


def validate_sql(sql: str, *, allowed_tables: frozenset[str] | None = None) -> GuardResult:
    violations: list[str] = []

    violations.extend(_validate_raw_sql_safety(sql))

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

    violations.extend(_validate_projection_safety(ast))

    # Rule 2: schema whitelist
    for table in ast.find_all(exp.Table):
        db = str(table.db or "").lower()
        if db and db not in ALLOWED_SCHEMAS:
            violations.append(f"Schema not allowed: {db}.{table.name}")
        elif not db:
            violations.append(f"Table without schema qualifier: {table.name}")

    if allowed_tables is not None:
        qtables = extract_qualified_table_names(ast)
        bad = sorted(t for t in qtables if t not in allowed_tables)
        if bad:
            violations.append(f"Disallowed table(s): {bad}")

    # Rule 3: blocked functions
    for func in ast.find_all(exp.Anonymous):
        name = (func.this or "").lower() if isinstance(func.this, str) else getattr(func.this, "name", "").lower()
        if name in BLOCKED_FUNCTIONS:
            violations.append(f"Blocked function: {name}")

    for func in ast.find_all(exp.Func):
        name = func.sql_name().lower() if hasattr(func, "sql_name") else ""
        if name in BLOCKED_FUNCTIONS:
            violations.append(f"Blocked function: {name}")

    violations.extend(_validate_future_date_bounds(sql))

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


def _strip_single_quoted_literals(sql: str) -> str:
    """Remove quoted literal bodies before raw-token checks."""
    return re.sub(r"'(?:''|\\'|[^'])*'", "''", sql or "")


def _validate_raw_sql_safety(sql: str) -> list[str]:
    raw = _strip_single_quoted_literals(sql)
    violations: list[str] = []
    if "--" in raw or "/*" in raw or "*/" in raw:
        violations.append("SQL comments are not allowed")
    return violations


def _validate_future_date_bounds(sql: str) -> list[str]:
    limit = today_local() + timedelta(days=1)
    dates = {
        m.group(1)
        for m in re.finditer(r"\b(?:toDate\s*\(\s*)?'(20\d{2}-\d{2}-\d{2})'", sql or "", flags=re.IGNORECASE)
    }
    violations: list[str] = []
    for value in sorted(dates):
        try:
            if date.fromisoformat(value) > limit:
                violations.append(f"Future date beyond allowed bound: {value}")
        except ValueError:
            continue
    return violations


# ── Tenant isolation helpers ──────────────────────────────────────────────────

def _outer_has_outlet_filter(ast: exp.Expression) -> bool:
    """
    Check the outermost SELECT's WHERE clause contains outlet_id IN (...)
    or outlet_id = <literal>. Nested WHERE clauses do not count.
    """
    outer = ast
    if isinstance(outer, exp.Subquery) and isinstance(outer.this, exp.Select):
        outer = outer.this
    if not isinstance(outer, exp.Select):
        return False
    where = outer.args.get("where")
    return bool(where and _where_has_outlet_filter(where))


def _lookup_only_subquery(inner: exp.Select, scoped: list[str]) -> bool:
    """Non-aggregating lookups touching only safe CDC bridge/dimension tables."""
    fullset = frozenset(scoped)
    if not fullset <= _LOOKUP_SUBQUERY_TABLES_OK_WITHOUT_LOCAL_OUTLET:
        return False
    if inner.args.get("group") or inner.find(exp.Group):
        return False
    if inner.find(exp.Window):
        return False
    agg_nodes = (exp.Sum, exp.Avg, exp.Min, exp.Max, exp.ArrayAgg, exp.Count)
    for at in agg_nodes:
        if inner.find(at):
            return False
    return True


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
        if _lookup_only_subquery(inner, scoped):
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
            db = str(node.db or "").lower()
            if db in ALLOWED_SCHEMAS:
                result.append(f"{db}.{str(node.name)}")
            return
        for child in node.iter_expressions():
            _walk(child)

    from_node = select.args.get("from_") or select.args.get("from")
    if from_node:
        _walk(from_node)
    for join in (select.args.get("joins") or []):
        _walk(join)

    return result


def _iter_selects(ast: exp.Expression) -> list[exp.Select]:
    out: list[exp.Select] = []
    seen: set[int] = set()
    if isinstance(ast, exp.Select):
        out.append(ast)
        seen.add(id(ast))
    for node in ast.find_all(exp.Select):
        if id(node) not in seen:
            out.append(node)
            seen.add(id(node))
    return out


def _direct_table_aliases(select: exp.Select) -> dict[str, str]:
    """Map aliases/table names/qualified names in a SELECT FROM/JOIN to full schema.table."""
    aliases: dict[str, str] = {}

    def _record(table: exp.Table) -> None:
        db = str(table.db or "").lower()
        name = str(table.name or "").strip("`").lower()
        if not db or not name:
            return
        full = f"{db}.{name}"
        aliases[name] = full
        aliases[full] = full
        alias = str(table.alias_or_name or "").strip("`").lower()
        if alias:
            aliases[alias] = full

    def _walk(node: exp.Expression) -> None:
        if isinstance(node, exp.Subquery):
            return
        if isinstance(node, exp.Table):
            _record(node)
            return
        for child in node.iter_expressions():
            _walk(child)

    from_node = select.args.get("from_") or select.args.get("from")
    if from_node:
        _walk(from_node)
    for join in (select.args.get("joins") or []):
        _walk(join)
    return aliases


def _tables_for_column(col: exp.Column, aliases: dict[str, str]) -> set[str]:
    qualifier = str(col.table or "").strip("`").lower()
    db = str(col.db or "").strip("`").lower()
    name = str(col.name or "").strip("`").lower()
    if db and qualifier:
        return {f"{db}.{qualifier}"}
    if qualifier:
        return {aliases.get(qualifier, qualifier)}
    return {full for full, blocked in TABLE_BLOCKED_SELECT_COLUMNS.items() if name in blocked}


def _projection_expr(expr: exp.Expression) -> exp.Expression:
    return expr.this if isinstance(expr, exp.Alias) and isinstance(expr.this, exp.Expression) else expr


def _validate_projection_safety(ast: exp.Expression) -> list[str]:
    """Reject broad or sensitive projections before SQL reaches execution."""
    violations: list[str] = []
    for select in _iter_selects(ast):
        aliases = _direct_table_aliases(select)
        for raw_expr in select.expressions or []:
            expr = _projection_expr(raw_expr)
            if isinstance(expr, exp.Star) or expr.find(exp.Star):
                violations.append("SELECT * is not allowed")
                continue
            for col in expr.find_all(exp.Column):
                name = str(col.name or "").strip("`").lower()
                if not name or name == "*":
                    continue
                for full in _tables_for_column(col, aliases):
                    blocked = TABLE_BLOCKED_SELECT_COLUMNS.get(full)
                    if blocked and name in blocked:
                        violations.append(f"Sensitive column projection not allowed: {full}.{name}")
    return violations


def _where_nodes(select: exp.Select) -> list[exp.Where]:
    return list(select.find_all(exp.Where))


def _select_direct_tables(select: exp.Select) -> set[str]:
    return set(_direct_table_aliases(select).values())


def _select_has_time_filter(select: exp.Select, full_table: str) -> bool:
    time_col = (TABLE_TIME_COLUMNS.get(full_table) or "").strip("`").lower()
    if not time_col:
        return True
    aliases = _direct_table_aliases(select)
    table_qualifiers = {key for key, value in aliases.items() if value == full_table}
    for where in _where_nodes(select):
        for col in where.find_all(exp.Column):
            name = str(col.name or "").strip("`").lower()
            if name != time_col:
                continue
            qualifier = str(col.table or "").strip("`").lower()
            if not qualifier or qualifier in table_qualifiers:
                return True
    return False


def _validate_required_time_filters(ast: exp.Expression, required_tables: frozenset[str]) -> list[str]:
    violations: list[str] = []
    seen: set[str] = set()
    for select in _iter_selects(ast):
        for full in sorted(_select_direct_tables(select) & required_tables):
            if full in seen:
                continue
            if not _select_has_time_filter(select, full):
                time_col = TABLE_TIME_COLUMNS.get(full) or "time_column"
                violations.append(f"Missing time filter for raw/detail table {full}.{time_col}")
                seen.add(full)
    return violations


def _where_has_outlet_filter(where: exp.Where) -> bool:
    """Return True if this WHERE contains outlet_id IN (...) or outlet_id = <literal>."""
    return _expr_has_local_outlet_filter(where.this)


def _expr_has_local_outlet_filter(node: exp.Expression | None) -> bool:
    """Search an expression, but do not descend into nested subqueries."""
    if node is None:
        return False
    if isinstance(node, (exp.Subquery, exp.Exists)):
        return False
    if isinstance(node, exp.In):
        col = node.this
        if isinstance(col, exp.Column) and col.name.lower() in OUTLET_COLUMNS:
            return True
    if isinstance(node, exp.EQ):
        left = node.left
        if isinstance(left, exp.Column) and left.name.lower() in OUTLET_COLUMNS:
            return True
    for child in node.iter_expressions():
        if _expr_has_local_outlet_filter(child):
            return True
    return False
