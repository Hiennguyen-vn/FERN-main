"""Soft coherence check between user question and final SQL (informational).

Hard guarantees remain: RBAC injector + AST sql_guard + executor timeouts.
"""

import logging

from typing import Any

from app.config import get_settings
from app.graph.nodes.contextualizer import effective_question
from app.graph.nodes.data_coverage import format_data_coverage_for_prompt
from app.graph.state import GraphState
from app.llm.openai_client import llm_call_json
from app.time_utils import format_time_context_for_prompt

logger = logging.getLogger(__name__)

_SQL_REVIEW_SCHEMA: dict[str, Any] = {
    "name": "sql_logical_review",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "consistent": {"type": "boolean"},
            "mismatch_risk": {"type": "string", "enum": ["low", "medium", "high"]},
            "notes_vi": {"type": "string"},
        },
        "required": ["consistent", "mismatch_risk", "notes_vi"],
        "additionalProperties": False,
    },
}

_SYSTEM = """Bạn là SQL logical reviewer trong pipeline FERN (ClickHouse analytics).

Đối chiếu câu hỏi của người dùng với SQL đã render (bao gồm filter outlet an toàn được inject backend).

ĐÁNH GIÁ:
- consistent=true chỉ khi SQL rõ ràng phục vụ đúng grain/metric của câu hỏi.
- mismatch_risk: low / medium / high (high = chỉ số sai, sai grain ngày/cửa hàng hoặc mục đích hoàn toàn lệch).
- notes_vi: 1–2 câu tiếng Việt chỉ điểm rủi ro; không lặp toàn văn SQL.

Lớp cứng (AST/policy) không thay thế được — chỉ báo không khớp logic khi có dấu hiệu."""

_MAX_SQL_CHARS = 5_500


def _truncate_sql(sql: str) -> str:
    s = sql.strip().replace("\n", " ")
    if len(s) <= _MAX_SQL_CHARS:
        return s
    return s[: _MAX_SQL_CHARS - 3] + "..."


def _neutral_pass() -> dict[str, Any]:
    return {"consistent": True, "mismatch_risk": "low", "notes_vi": ""}


async def sql_logical_check(state: GraphState) -> GraphState:
    if not get_settings().sql_logical_check_enabled:
        state.setdefault("trace", []).append({"node": "sql_logical_check", "skipped": True, "reason": "disabled"})
        return state

    sql = (state.get("corrected_sql") or state.get("final_sql") or "").strip()
    if not sql:
        state.setdefault("trace", []).append({"node": "sql_logical_check", "skipped": True, "reason": "no_sql"})
        return state

    if state.get("template_key") == "T31_outlet_directory":
        state["sql_logical_check"] = _neutral_pass()
        state.setdefault("trace", []).append(
            {"node": "sql_logical_check", "skipped": True, "reason": "deterministic_outlet_lookup"}
        )
        return state

    question = effective_question(state)
    template_key = state.get("template_key")
    reasoning = ""

    blob = state.get("reasoning_outline")
    if isinstance(blob, dict) and blob.get("problem_paraphrase_vi"):
        reasoning = str(blob.get("problem_paraphrase_vi")).strip()

    outline_block = f"\nDự thảo planner: {reasoning}\n" if reasoning else ""
    time_block = format_time_context_for_prompt(state.get("time_context"))
    coverage_block = format_data_coverage_for_prompt(state.get("data_coverage_context"))

    user_prompt = f"""Câu hỏi: {question}
Template_key: {template_key}
{outline_block}
{time_block}{coverage_block}
SQL (đã cắt gọn nếu dài):
{_truncate_sql(sql)}
"""

    try:
        parsed, usage = await llm_call_json(
            system_prompt=_SYSTEM,
            user_prompt=user_prompt,
            json_schema=_SQL_REVIEW_SCHEMA,
            temperature=0.0,
            max_tokens=400,
            agent="reviewer",
        )
        if not isinstance(parsed, dict):
            state["sql_logical_check"] = _neutral_pass()
        else:
            risk = str(parsed.get("mismatch_risk") or "low").lower().strip()
            if risk not in ("low", "medium", "high"):
                risk = "low"
            state["sql_logical_check"] = {
                "consistent": bool(parsed.get("consistent")),
                "mismatch_risk": risk,
                "notes_vi": str(parsed.get("notes_vi") or "").strip(),
            }
        ext = usage if isinstance(usage, dict) else {}
        state.setdefault("trace", []).append({"node": "sql_logical_check", **ext})
    except Exception as e:  # noqa: BLE001
        logger.warning("sql_logical_check failed: %s", e)
        state["sql_logical_check"] = _neutral_pass()
        state.setdefault("trace", []).append(
            {
                "node": "sql_logical_check",
                "tokens_in": 0,
                "tokens_out": 0,
                "latency_ms": 0,
                "error": str(e)[:160],
            }
        )
    return state
