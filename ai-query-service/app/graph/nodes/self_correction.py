"""GPT-4.1: fix SQL syntax error. Must NOT change WHERE clause."""
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
    "unknown identifier",
    "unknown column",
    "missing columns",
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


async def self_correction(state: GraphState) -> GraphState:
    state["self_correction_applied"] = False
    if state.get("correction_attempts", 0) >= 2:
        state.setdefault("trace", []).append({"node": "self_correction", "skipped": True, "reason": "attempt_limit"})
        return state

    error = state.get("execution_error", "")
    sql = state.get("final_sql", "")
    if not error or not sql:
        state.setdefault("trace", []).append({"node": "self_correction", "skipped": True, "reason": "missing_context"})
        return state

    if not is_self_correction_candidate(error):
        state.setdefault("trace", []).append({"node": "self_correction", "skipped": True, "reason": "non_fixable_error"})
        return state

    user_prompt = f"""SQL gốc:
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
        outcome = "corrected"
    else:
        outcome = "aborted" if parsed.get("abort") else "no_change"
    state.setdefault("trace", []).append({"node": "self_correction", **usage, "outcome": outcome})
    return state
