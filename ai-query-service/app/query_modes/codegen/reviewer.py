"""GenSQL semantic reviewer node."""

import logging

from app.config import get_settings
from app.graph.nodes.contextualizer import effective_question
from app.graph.nodes.data_coverage import format_data_coverage_for_prompt
from app.graph.state import GraphState
from app.llm.openai_client import llm_call_json
from app.time_utils import format_time_context_for_prompt


_REVIEW_SCHEMA = {
    "name": "codegen_sql_review",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "approve": {"type": "boolean"},
            "risk": {"type": "string", "enum": ["low", "medium", "high"]},
            "feedback_to_generator_vi": {"type": "string"},
        },
        "required": ["approve", "risk", "feedback_to_generator_vi"],
        "additionalProperties": False,
    },
}

_REVIEW_SYSTEM = """Bạn là Reviewer cho SQL đã qua inject RBAC outlet (không được sửa SQL).

Đánh giá approve=true chỉ khi SELECT có vẻ trả lời đúng mục đích câu hỏi và không có dấu hiệu grain/metric sai rõ ràng.

risk: low/medium/high.
feedback_to_generator_vi: gợi ý ngắn nếu approve=false (tiếng Việt)."""

logger = logging.getLogger(__name__)


async def codegen_reviewer(state: GraphState) -> GraphState:
    s = get_settings()
    if not s.codegen_review_enabled:
        state["codegen_review_approve"] = True
        state.setdefault("trace", []).append({"node": "codegen_reviewer", "skipped": True})
        return state

    sql = (state.get("final_sql") or "").strip()
    q = effective_question(state)
    time_block = format_time_context_for_prompt(state.get("time_context"))
    coverage_block = format_data_coverage_for_prompt(state.get("data_coverage_context"))

    try:
        parsed, usage = await llm_call_json(
            system_prompt=_REVIEW_SYSTEM,
            user_prompt=(
                f"Câu hỏi:\n{q}\n"
                f"{time_block}{coverage_block}\n"
                f"SQL sau RBAC inject:\n{sql[:12000]}"
            ),
            json_schema=_REVIEW_SCHEMA,
            temperature=0.05,
            max_tokens=500,
            agent="reviewer",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("codegen_reviewer LLM failed: %s", e)
        state["codegen_review_approve"] = False
        state["codegen_reviewer_risk"] = "high"
        state["codegen_last_error_vi"] = f"Reviewer unavailable: {e}"
        state.setdefault("trace", []).append({"node": "codegen_reviewer", "error": str(e)[:200]})
        return state

    approve = bool(parsed.get("approve"))
    risk = str(parsed.get("risk") or "medium")
    fb = (parsed.get("feedback_to_generator_vi") or "").strip()

    state["codegen_review_approve"] = approve
    state["codegen_reviewer_risk"] = risk

    if approve:
        state.pop("codegen_last_error_vi", None)
    else:
        state["codegen_last_error_vi"] = f"Reviewer ({risk}): {fb or 'Không duyệt, vui lòng sửa logic/grain.'}"

    state.setdefault("trace", []).append({"node": "codegen_reviewer", "approve": approve, "risk": risk, **usage})
    return state
