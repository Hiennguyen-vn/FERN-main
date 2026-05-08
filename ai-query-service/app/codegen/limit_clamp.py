"""Clamp or inject outer SELECT LIMIT (generator không được tin tưởng tuyệt đối)."""

from __future__ import annotations

import sqlglot
from sqlglot import expressions as exp


def _unwrap_outer_select(root: exp.Expression) -> exp.Select:
    ast = root
    if isinstance(ast, exp.Subquery):
        inner = ast.this
        if isinstance(inner, exp.Select):
            ast = inner
    if not isinstance(ast, exp.Select):
        raise ValueError(f"clamp_outer_limit expects SELECT, got {type(ast).__name__}")
    return ast


def clamp_outer_limit(sql: str, cap: int) -> str:
    """
    Set outer LIMIT to min(existing literal LIMIT, cap), or add LIMIT cap if absent.
    Non-literal LIMIT expressions are replaced with LIMIT cap. OFFSET on the SELECT is preserved.
    """
    cap_i = max(1, min(int(cap), 10_000_000))

    statements = sqlglot.parse(sql, dialect="clickhouse")
    if not statements or len(statements) != 1 or statements[0] is None:
        raise ValueError("Expected exactly one SQL statement")

    ast = _unwrap_outer_select(statements[0])
    lim = ast.args.get("limit")

    if lim is None:
        ast.set("limit", exp.Limit(expression=exp.Literal.number(cap_i)))
        return ast.sql(dialect="clickhouse")

    expr = lim.expression
    new_n = cap_i
    if isinstance(expr, exp.Literal):
        try:
            raw = expr.this
            n = int(raw) if not isinstance(raw, bool) else cap_i
            new_n = max(1, min(n, cap_i))
        except (ValueError, TypeError):
            new_n = cap_i

    ast.set("limit", exp.Limit(expression=exp.Literal.number(new_n)))
    return ast.sql(dialect="clickhouse")
