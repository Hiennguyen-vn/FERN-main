"""SQL self-correction node for retryable ClickHouse guard/runtime errors."""
from __future__ import annotations

import re

from app.graph.state import GraphState
from app.llm.openai_client import llm_call_json


SELF_CORRECTION_SCHEMA = {
    "name": "self_correction_result",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "abort": {"type": "boolean"},
            "corrected_sql": {"type": ["string", "null"]},
            "reasoning": {"type": "string"},
        },
        "required": ["abort", "corrected_sql", "reasoning"],
        "additionalProperties": False,
    },
}


_SYSTEM = """Bạn là SQL Self-Correction agent cho ClickHouse.

NHIỆM VỤ: sửa LỖI SYNTAX trong SQL được cung cấp dựa trên error message.

QUY TẮC NGHIÊM NGẶT (vi phạm = abort):
- KHÔNG thay đổi WHERE clause (đặc biệt là điều kiện outlet_id IN (...) hoặc outletId IN (...))
- KHÔNG thay đổi danh sách outlet_ids
- KHÔNG thêm hoặc bớt JOIN
- KHÔNG thay đổi schema/table name
- Chỉ sửa lỗi syntax: typo, missing comma, wrong function name, etc.

Nếu lỗi không phải syntax (permission, table not found, etc.) → abort=true, corrected_sql=null.
"""

_NON_RETRYABLE_ERROR_MARKERS = (
    "permission",
    "access denied",
    "not enough privileges",
    "readonly",
    "read-only",
    "unknown table",
    "unknown database",
    "table doesn't exist",
    "table does not exist",
    "database doesn't exist",
    "database does not exist",
    "memory limit",
    "max_execution_time",
    "timed out",
    "timeout",
    "quota",
    "too many simultaneous queries",
    "network error",
    "connection refused",
    "connection reset",
    "socket",
    "transport",
)

_RETRYABLE_ERROR_MARKERS = (
    "syntax error",
    "failed at position",
    "expected one of",
    "unmatched parentheses",
    "parse error",
    "parser error",
    "cannot parse input",
    "cannot parse expression",
    "unknown function",
    "unknown identifier",
    "unknown column",
    "missing columns",
)


def classify_self_correction_error(error: str | None) -> str | None:
    text = str(error or "").strip().lower()
    if not text:
        return None
    if any(marker in text for marker in _NON_RETRYABLE_ERROR_MARKERS):
        return None
    if any(marker in text for marker in _RETRYABLE_ERROR_MARKERS):
        return "syntax_or_parse"
    return None


def is_self_correction_candidate(error: str | None) -> bool:
    return classify_self_correction_error(error) is not None


def _split_select_expressions(select_part: str) -> list[str]:
    expressions: list[str] = []
    buf: list[str] = []
    depth = 0
    in_quote = False
    i = 0
    while i < len(select_part):
        ch = select_part[i]
        if ch == "'" and (i == 0 or select_part[i - 1] != "\\"):
            in_quote = not in_quote
        elif not in_quote:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth = max(0, depth - 1)
            elif ch == "," and depth == 0:
                expressions.append("".join(buf).strip())
                buf = []
                i += 1
                continue
        buf.append(ch)
        i += 1
    last = "".join(buf).strip()
    if last:
        expressions.append(last)
    return expressions


def _strip_alias(expr: str) -> str:
    return re.sub(r"\s+AS\s+(?:\"[^\"]+\"|`[^`]+`|[A-Za-z_][\w]*)\s*$", "", expr.strip(), flags=re.IGNORECASE)


def _replace_group_by_ordinals(sql: str) -> tuple[str, bool]:
    match = re.search(r"\bSELECT\b(?P<select>.*?)\bFROM\b", sql, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return sql, False
    select_exprs = [_strip_alias(expr) for expr in _split_select_expressions(match.group("select"))]

    def repl(group_match: re.Match[str]) -> str:
        raw = group_match.group("items")
        parts = [p.strip() for p in raw.split(",")]
        resolved: list[str] = []
        changed = False
        for part in parts:
            if part.isdigit():
                idx = int(part) - 1
                if 0 <= idx < len(select_exprs):
                    resolved.append(select_exprs[idx])
                    changed = True
                    continue
            resolved.append(part)
        repl.changed = changed  # type: ignore[attr-defined]
        return "GROUP BY " + ", ".join(resolved)

    repl.changed = False  # type: ignore[attr-defined]
    new_sql = re.sub(
        r"\bGROUP\s+BY\s+(?P<items>[0-9,\s]+)(?=\s+(?:ORDER|LIMIT|HAVING)\b|\s*$)",
        repl,
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return new_sql, bool(repl.changed)  # type: ignore[attr-defined]


def deterministic_clickhouse_syntax_fix(sql: str, error: str | None = None) -> tuple[str | None, list[str]]:
    """Apply conservative, deterministic ClickHouse syntax repairs.

    This covers common MySQL/Postgres function leaks before asking the LLM. It
    never removes WHERE predicates or weakens RBAC/security conditions.
    """
    original = (sql or "").strip()
    fixed = original
    changes: list[str] = []

    def replace(pattern: str, repl: str, label: str) -> None:
        nonlocal fixed
        new = re.sub(pattern, repl, fixed, flags=re.IGNORECASE)
        if new != fixed:
            fixed = new
            changes.append(label)

    replace(
        r"\bDATE_FORMAT\s*\(\s*([A-Za-z_][\w.]*)\s*,\s*'%Y-%m'\s*\)",
        r'toStartOfMonth(\1) AS "Tháng"',
        "DATE_FORMAT(date, '%Y-%m') -> toStartOfMonth(date)",
    )
    replace(r"\bYEAR\s*\(", "toYear(", "YEAR(date) -> toYear(date)")
    replace(r"\bMONTH\s*\(", "toMonth(", "MONTH(date) -> toMonth(date)")
    replace(r"\bNOW\s*\(", "now(", "NOW() -> now()")
    replace(r"\bCURRENT_DATE\b", "today()", "CURRENT_DATE -> today()")
    replace(r"\bISNULL\s*\(", "isNull(", "ISNULL(col) -> isNull(col)")
    replace(r"\bIFNULL\s*\(", "ifNull(", "IFNULL(col, x) -> ifNull(col, x)")
    replace(
        r"\bLIMIT\s+(\d+)\s+OFFSET\s+(\d+)\b",
        r"LIMIT \2, \1",
        "LIMIT x OFFSET y -> LIMIT y, x",
    )
    replace(
        r'\bSUM\s*\(\s*revenue\s*\)(?!\s+AS\b)',
        r'SUM(revenue) AS "Doanh thu"',
        'Add Vietnamese alias for SUM(revenue)',
    )

    grouped, grouped_changed = _replace_group_by_ordinals(fixed)
    if grouped_changed:
        fixed = grouped
        changes.append("GROUP BY ordinal -> explicit expression")
    if changes and "ORDER BY" not in fixed.upper():
        fixed = fixed.rstrip().rstrip(";") + "\nORDER BY 1"
        changes.append("Add deterministic ORDER BY 1")

    if fixed.strip() == original:
        return None, []
    return fixed.strip(), changes


async def self_correction(state: GraphState) -> GraphState:
    state["self_correction_applied"] = False
    retry_count = int(state.get("correction_attempts") or 0)
    if retry_count >= 3:
        state["self_correction_status"] = "CANNOT_FIX"
        state["escalation_candidate"] = True
        state["escalation_reason"] = "self_correction_attempt_limit"
        state["clarification_question"] = (
            "Hệ thống không thể tạo query phù hợp sau 3 lần thử. "
            "Vui lòng diễn đạt lại hoặc liên hệ admin."
        )
        state.setdefault("trace", []).append({"node": "self_correction", "skipped": True, "reason": "attempt_limit"})
        return state

    error = state.get("execution_error", "")
    sql = state.get("final_sql", "")
    if not error or not sql:
        state.setdefault("trace", []).append({"node": "self_correction", "skipped": True, "reason": "missing_context"})
        return state

    if not is_self_correction_candidate(error):
        state["self_correction_status"] = "CANNOT_FIX"
        state.setdefault("trace", []).append({"node": "self_correction", "skipped": True, "reason": "non_fixable_error"})
        return state

    deterministic_sql, deterministic_changes = deterministic_clickhouse_syntax_fix(sql, error)
    if deterministic_sql and deterministic_sql != sql.strip():
        state["corrected_sql"] = deterministic_sql
        state["guard_passed"] = False
        state["self_correction_applied"] = True
        state["self_correction_status"] = "FIXED"
        state["self_correction_changes"] = deterministic_changes
        state.setdefault("trace", []).append(
            {
                "node": "self_correction",
                "outcome": "corrected",
                "strategy": "deterministic_clickhouse_syntax_fix",
                "retry_count": retry_count,
            }
        )
        return state

    strategy = (
        "Sửa theo fix_hint/lỗi trực tiếp."
        if retry_count <= 1
        else "Viết lại SQL từ đầu dựa trên cùng context; không patch từng đoạn nhỏ."
    )
    user_prompt = f"""Retry count: {retry_count}
Chiến lược: {strategy}

SQL gốc:
{sql}

Lỗi:
{error}

Trả về JSON theo schema."""

    parsed, usage = await llm_call_json(
        system_prompt=_SYSTEM,
        user_prompt=user_prompt,
        json_schema=SELF_CORRECTION_SCHEMA,
        temperature=0.0,
    )

    corrected_sql = str(parsed.get("corrected_sql") or "").strip()
    if not parsed.get("abort") and corrected_sql and corrected_sql != sql.strip():
        state["corrected_sql"] = corrected_sql
        # Reset guard state so sql_guard re-validates corrected SQL
        state["guard_passed"] = False
        state["self_correction_applied"] = True
        state["self_correction_status"] = "FIXED"
        outcome = "corrected"
    else:
        state["self_correction_status"] = "CANNOT_FIX"
        outcome = "aborted" if parsed.get("abort") else "no_change"
    state.setdefault("trace", []).append({"node": "self_correction", **usage, "outcome": outcome, "retry_count": retry_count})
    return state
