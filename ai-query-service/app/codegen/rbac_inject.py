"""Programmatic outlet scope injection into ClickHouse SELECT AST (no LLM)."""

from __future__ import annotations

import sqlglot
from sqlglot import expressions as exp

from app.query_policy import ALLOWED_FULL_TABLES, LOOKUP_ONLY_TABLES, TABLE_OUTLET_COLUMNS


def _maybe_strip_quotes(ident: str) -> str:
    if len(ident) >= 2 and ident[0] == ident[-1] == "`":
        return ident[1:-1]
    return ident


def _collect_tables_ordered(select: exp.Select) -> list[exp.Table]:
    tables: list[exp.Table] = []
    fro = select.args.get("from_") or select.args.get("from")
    if fro:
        base = fro.this if isinstance(fro, exp.From) else fro
        if isinstance(base, exp.Table):
            tables.append(base)
        else:
            for t in base.find_all(exp.Table):
                tables.append(t)
    for j in select.args.get("joins") or []:
        if isinstance(j, exp.Join) and isinstance(j.this, exp.Table):
            tables.append(j.this)
        else:
            for t in j.find_all(exp.Table):
                tables.append(t)
    return tables


def _qual(t: exp.Table) -> str:
    db = (t.db or "").lower()
    name = _maybe_strip_quotes(str(t.name or "").lower())
    return f"{db}.{name}"


def _primary_outlet_column(select: exp.Select) -> exp.Expression:
    """
    Prefer alias from first allow-listed grain table (skip bare dim outlet when facts exist).
    Fallback: bare outlet_id (single-table / ambiguous cases).
    """
    ordered = _collect_tables_ordered(select)
    qualified_rows = [(t, _qual(t)) for t in ordered]
    in_allow = [(t, q) for t, q in qualified_rows if q in ALLOWED_FULL_TABLES]
    if not in_allow:
        raise ValueError("No allow-listed table found for outlet scope")

    scoped = [(t, q) for t, q in in_allow if TABLE_OUTLET_COLUMNS.get(q)]
    if not scoped:
        raise ValueError("No scoped fact/event table with known outlet column")

    facts = [(t, q) for t, q in scoped if q not in LOOKUP_ONLY_TABLES]
    pick = facts[0] if facts else scoped[0]
    table, q = pick
    alias = table.alias_or_name
    outlet_col = TABLE_OUTLET_COLUMNS.get(q)
    if not outlet_col:
        raise ValueError(f"No outlet scope column configured for {q}")
    col = exp.Column(this=exp.to_identifier(outlet_col))
    if alias:
        col.set("table", exp.to_identifier(_maybe_strip_quotes(str(alias))))
    return col


def _iter_selects(root: exp.Expression) -> list[exp.Select]:
    selects: list[exp.Select] = []
    seen: set[int] = set()
    if isinstance(root, exp.Subquery) and isinstance(root.this, exp.Select):
        root = root.this
    if isinstance(root, exp.Select):
        selects.append(root)
        seen.add(id(root))
    for node in root.find_all(exp.Select):
        if id(node) not in seen:
            selects.append(node)
            seen.add(id(node))
    return selects


def _append_outlet_filter(select: exp.Select, outlet_ids: list[int]) -> bool:
    try:
        outlet_col = _primary_outlet_column(select)
    except ValueError:
        return False

    in_expr = exp.In(
        this=outlet_col,
        expressions=[exp.Literal.number(i) for i in outlet_ids],
    )

    where = select.args.get("where")
    if where:
        merged = exp.And(this=where.this, expression=in_expr)
        select.set("where", exp.Where(this=merged))
    else:
        select.set("where", exp.Where(this=in_expr))
    return True


def inject_outlet_filter(sql: str, outlet_ids: list[int]) -> str:
    """Append outlet scope to every scoped SELECT (ClickHouse dialect).

    Phase-1 SQL Writer may use derived tables for rankings/window-like logic.
    The post-inject guard requires each scoped subquery to carry tenant scope,
    so the injector owns that rewrite instead of asking the model to place RBAC
    predicates itself.
    """
    if not outlet_ids or not all(isinstance(x, int) for x in outlet_ids):
        raise ValueError("outlet_ids must be non-empty list[int]")

    statements = sqlglot.parse(sql, dialect="clickhouse")
    if not statements or len(statements) != 1:
        raise ValueError("Expected exactly one SQL statement")

    root = statements[0]
    if root is None:
        raise ValueError("Empty statement")

    if not isinstance(root, (exp.Select, exp.Subquery)):
        raise ValueError(f"GenSQL injector expects SELECT at outer level, got {type(root).__name__}")

    injected_count = 0
    for select in _iter_selects(root):
        if _append_outlet_filter(select, outlet_ids):
            injected_count += 1

    if injected_count == 0:
        raise ValueError("No scoped fact/event table with known outlet column")

    return root.sql(dialect="clickhouse")
