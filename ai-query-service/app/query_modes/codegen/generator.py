"""GenSQL generator node."""

import logging

from app.graph.nodes.catalog_digest import format_catalog_digest_for_prompt
from app.graph.nodes.contextualizer import effective_question
from app.graph.nodes.data_coverage import format_data_coverage_for_prompt
from app.graph.nodes.metadata_context import format_metadata_context_for_prompt
from app.graph.nodes.query_reasoner import format_reasoning_outline_for_matcher
from app.graph.state import GraphState
from app.llm.openai_client import llm_call_json
from app.query_policy import candidate_tables_for_prompt, format_domain_contract
from app.query_modes.codegen.planner import format_sql_plan_for_prompt
from app.time_utils import format_time_context_for_prompt

logger = logging.getLogger(__name__)


_GEN_SCHEMA = {
    "name": "codegen_sql_proposal",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "proposed_sql": {"type": "string"},
            "rationale_vi": {"type": "string"},
            "assumption_vi": {"type": "string"},
            "tables_used": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["proposed_sql", "rationale_vi", "assumption_vi", "tables_used"],
        "additionalProperties": False,
    },
}

_GEN_SYSTEM = """Bạn là SQL Generator cho FERN AI Analyst (ClickHouse, READ ONLY).

CHỈ sinh MỘT câu SELECT đơn (không WITH/CTE, không UNION, không DDL/DML).

Quy tắc bắt buộc:
- Luôn viết đầy đủ schema.table cho mọi FROM/JOIN (vd analytics.fct_sales_daily, cdc.fact_sale).
- **KHÔNG** thêm điều kiện outlet_id — backend sẽ inject an toàn sau (đừng cố filter cửa hàng).
- Không dùng hàm system/file/url/remote/cluster...
- Giữ query có thể kiểm tra cú pháp trên ClickHouse; tránh cú pháp không chuẩn.

Chỉ được dùng bảng trong danh sách ALLOWED_TABLES (input).
Nếu có khối **Kế hoạch SQL** với **các bước logic**, hãy chuyển tuần tự các bước đó thành **một** SELECT ClickHouse hợp lệ duy nhất (đừng bỏ sót bước lọc thời gian/metric đã nêu).
Có thể thêm LIMIT — backend sẽ siết lại không vượt quá ngưỡng an toàn.
Viết tiếng Việt ngắn:
- rationale_vi: vì sao chọn bảng/metric chính (1–2 câu).
- assumption_vi: grain/thời gian/giả định scope (backend sẽ inject outlet)."""


async def codegen_generator(state: GraphState) -> GraphState:
    question = effective_question(state)
    intent = state.get("intent")
    candidate_tables = list(state.get("codegen_candidate_tables") or [])
    if not candidate_tables:
        candidate_tables = candidate_tables_for_prompt(
            intent,
            question=question,
            max_tables=10,
            include_fallbacks=True,
        )
        state["codegen_candidate_tables"] = candidate_tables
    allowed_list = "\n".join(f"- {t}" for t in candidate_tables)
    time_range = state.get("time_range") or {}
    resolved = state.get("resolved_entities") or {}
    fb = (state.get("codegen_feedback_vi") or "").strip()
    fb_block = f"\nPhản hồi chỉnh sửa từ validator/reviewer/trial:\n{fb}\n" if fb else ""

    catalog_block = format_catalog_digest_for_prompt(state.get("catalog_digest"))
    metadata_block = format_metadata_context_for_prompt(state.get("metadata_context"))
    domain_block = "\n" + format_domain_contract(
        intent=intent,
        question=question,
        max_tables=10,
        include_fallbacks=True,
    ) + "\n"
    time_block = format_time_context_for_prompt(state.get("time_context"))
    coverage_block = format_data_coverage_for_prompt(state.get("data_coverage_context"))
    outline = state.get("reasoning_outline")
    reasoning_block = format_reasoning_outline_for_matcher(outline if isinstance(outline, dict) else None)
    plan_block = format_sql_plan_for_prompt(state.get("codegen_sql_plan") if isinstance(state.get("codegen_sql_plan"), dict) else None)

    original = (state.get("normalized_question") or "").strip()
    original_block = f"Câu hỏi gốc: {original}\n" if original and original != question else ""

    user_prompt = f"""ALLOWED_TABLES (chỉ được FROM/JOIN các bảng sau):
{allowed_list}

{original_block}Câu hỏi hiệu lực: {question}
Intent: {intent}
Time range (supervisor): {time_range}
Resolved entities: {resolved}
{time_block}{coverage_block}{domain_block}{plan_block}{metadata_block}{catalog_block}{reasoning_block}{fb_block}

Trả về proposed_sql (một SELECT ClickHouse), rationale_vi, assumption_vi, tables_used khớp AST (đủ schema.table lowercase).
Tables_used phải khớp các bảng thực sự xuất hiện trong proposed_sql; ưu tiên bám **kế hoạch SQL** phía trên nếu có.
"""

    try:
        parsed, usage = await llm_call_json(
            system_prompt=_GEN_SYSTEM,
            user_prompt=user_prompt,
            json_schema=_GEN_SCHEMA,
            temperature=0.05,
            max_tokens=1200,
            agent="sql_generator",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("codegen_generator LLM failed: %s", e)
        state["codegen_proposed_sql"] = ""
        state["codegen_tables_used"] = []
        state["codegen_last_error_vi"] = f"SQL Writer unavailable: {e}"
        state.setdefault("trace", []).append({"node": "codegen_generator", "error": str(e)[:200]})
        return state

    sql_raw = (parsed.get("proposed_sql") or "").strip().rstrip(";")
    tables_used = [str(x).strip().lower() for x in (parsed.get("tables_used") or []) if str(x).strip()]
    rat = (parsed.get("rationale_vi") or "").strip()
    asm = (parsed.get("assumption_vi") or "").strip()
    state["codegen_proposed_sql"] = sql_raw
    state["codegen_tables_used"] = tables_used
    state["codegen_rationale_vi"] = rat
    state["codegen_assumption_vi"] = asm
    state.setdefault("trace", []).append({"node": "codegen_generator", **usage})
    return state
