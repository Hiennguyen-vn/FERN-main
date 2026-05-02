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


async def self_correction(state: GraphState) -> GraphState:
    if state.get("correction_attempts", 0) >= 2:
        return state

    error = state.get("execution_error", "")
    sql = state.get("final_sql", "")
    if not error or not sql:
        return state

    # Permission errors → abort immediately
    if "permission" in error.lower() or "access denied" in error.lower():
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

    if not parsed.get("abort") and parsed.get("corrected_sql"):
        state["corrected_sql"] = parsed["corrected_sql"]
        # Reset guard state so sql_guard re-validates corrected SQL
        state["guard_passed"] = False
    state.setdefault("trace", []).append({"node": "self_correction", **usage})
    return state
