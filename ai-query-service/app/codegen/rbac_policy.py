"""SPEC + verification for programmatic GenSQL outlet scope (no LLM).

Contract (summary):
- ``inject_outlet_filter`` picks the **first allow-listed grain table** in FROM/JOIN order
  that has a non-null ``TABLE_OUTLET_COLUMNS`` entry; prefers fact/event tables over pure
  lookup dims (e.g. skips ``cdc.product`` / ``cdc.outlet`` as primary scope).
- It appends ``AND <alias>.<outlet_col> IN (...)`` on the **outer** SELECT; GenSQL must not
  rely on LLM-placed outlet predicates — guard still runs after inject.
- If no scoped table is found or AST rewrite fails, GenSQL must **retry generator** or
  **fallback template** — never execute raw proposed SQL.

This module provides a cheap post-inject check that the expected ``IN`` literal set exists
so mis-generated SQL cannot slip past a buggy rewriter silently.
"""

from __future__ import annotations

import sqlglot
from sqlglot import expressions as exp


def verify_outlet_in_clause(sql: str, outlet_ids: list[int]) -> tuple[bool, str]:
    """
    Return True if outer WHERE contains ``outlet_id IN (<exact set>)`` or ``outletId IN (...)``
    matching ``outlet_ids`` (order-independent).
    """
    if not outlet_ids:
        return False, "empty outlet_ids"
    wanted = frozenset(int(x) for x in outlet_ids)

    statements = sqlglot.parse(sql, dialect="clickhouse")
    if not statements or len(statements) != 1:
        return False, "expected single statement"
    root = statements[0]
    if root is None:
        return False, "empty statement"

    ast = root
    if isinstance(ast, exp.Subquery):
        inner = ast.this
        if isinstance(inner, exp.Select):
            ast = inner

    if not isinstance(ast, exp.Select):
        return False, f"expected SELECT, got {type(ast).__name__}"

    where = ast.args.get("where")
    if not where or not where.this:
        return False, "missing WHERE"

    for inn in where.find_all(exp.In):
        col = inn.this
        if not isinstance(col, exp.Column):
            continue
        name = (col.name or "").strip("`").lower()
        if name not in ("outlet_id", "outletid"):
            continue
        got: set[int] = set()
        for ex in inn.expressions:
            if isinstance(ex, exp.Literal):
                try:
                    got.add(int(ex.this))
                except (TypeError, ValueError):
                    continue
        if frozenset(got) == wanted:
            return True, ""

    return False, "no outlet_id/outletId IN clause matching allowed outlets"
