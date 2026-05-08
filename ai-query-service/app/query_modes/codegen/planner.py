"""GenSQL SQL plan agent — structured intent before raw SELECT generation."""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.graph.nodes.catalog_digest import format_catalog_digest_for_prompt
from app.graph.nodes.contextualizer import effective_question
from app.graph.nodes.data_coverage import format_data_coverage_for_prompt
from app.graph.nodes.metadata_context import format_metadata_context_for_prompt
from app.graph.nodes.query_reasoner import format_reasoning_outline_for_matcher
from app.graph.state import GraphState
from app.query_policy import ALLOWED_FULL_TABLES, candidate_tables_for_prompt, format_domain_contract
from app.llm.openai_client import llm_call_json
from app.time_utils import format_time_context_for_prompt

logger = logging.getLogger(__name__)

_SQL_PLAN_SCHEMA: dict[str, Any] = {
    "name": "codegen_sql_plan",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "goal_vi": {"type": "string"},
            "primary_tables": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "optional_tables": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "grain_vi": {"type": "string"},
            "time_binding_vi": {"type": "string"},
            "metric_plan_vi": {"type": "array", "items": {"type": "string"}, "maxItems": 10},
            "join_hints_vi": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "filter_hints_vi": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "risk_notes_vi": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
            "must_avoid_vi": {"type": "array", "items": {"type": "string"}, "maxItems": 10},
            "logical_steps_vi": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 12,
                "description": "Ordered steps toward one SELECT (no SQL keywords as full statement)",
            },
        },
        "required": [
            "goal_vi",
            "primary_tables",
            "optional_tables",
            "grain_vi",
            "time_binding_vi",
            "metric_plan_vi",
            "join_hints_vi",
            "filter_hints_vi",
            "risk_notes_vi",
            "must_avoid_vi",
            "logical_steps_vi",
        ],
        "additionalProperties": False,
    },
}

_SYSTEM = """Bạn là SQL Planning Agent cho GenSQL (FERN AI Analyst, ClickHouse).

NHIỆM VỤ: lập **kế hoạch** để agent khác sinh **đúng một** câu SELECT — JSON có cấu trúc.

QUY TẮC NGHIÊM NGẶT:
- **KHÔNG** viết SQL hoàn chỉnh, **KHÔNG** phép SELECT/FROM/WHERE đủ thành câu chạy được trong một chuỗi duy nhất.
- `logical_steps_vi`: **3–8 bước có thứ tự** (tiếng Việt), mô tả luồng đọc dữ liệu: nguồn bảng → JOIN nếu cần → điều kiện thời gian/cột ngày → nhóm/metric → sắp xếp/giới hạn — để Generator **chuyển thành một SELECT**.
- `primary_tables` / `optional_tables`: chỉ `schema.table` **trùng** ALLOWED_TABLES trong input (chữ thường).
- `must_avoid_vi`: nhắc không WITH/CTE, không UNION, không outlet_id trong SQL generator, không hàm system/file/url...
- Kết hợp time_range và reasoning outline (nếu có).
"""


def _filter_allowed_tables(names: list[str], *, allowed_subset: set[str] | None = None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in names:
        key = str(raw).strip().lower()
        if key in ALLOWED_FULL_TABLES and (allowed_subset is None or key in allowed_subset) and key not in seen:
            seen.add(key)
            out.append(key)
    return out


def _learned_sql_writer_plan(state: GraphState, *, candidate_tables: list[str]) -> dict[str, Any]:
    learned = state.get("learned_sql_writer_scenario_asset")
    asset = learned if isinstance(learned, dict) else {}
    stored = asset.get("sql_plan") if isinstance(asset.get("sql_plan"), dict) else {}
    report_spec = asset.get("report_spec") if isinstance(asset.get("report_spec"), dict) else {}
    metrics = [str(x).strip() for x in (asset.get("metric_ids") or []) if str(x).strip()]
    used = _filter_allowed_tables(list(asset.get("tables_used") or []), allowed_subset=set(candidate_tables))
    primary = _filter_allowed_tables(list(stored.get("primary_tables") or []), allowed_subset=set(candidate_tables))
    optional = _filter_allowed_tables(list(stored.get("optional_tables") or []), allowed_subset=set(candidate_tables))
    if not primary:
        primary = used[:2] or candidate_tables[:2]
    optional = [x for x in optional if x not in set(primary)]
    if not optional:
        optional = [x for x in candidate_tables if x not in set(primary)][:6]

    group_by = str(report_spec.get("group_by") or "").strip()
    analysis_mode = str(report_spec.get("analysis_mode") or "").strip()
    time_axis = str(report_spec.get("time_axis") or "").strip()
    metric_text = ", ".join(metrics) if metrics else "metric trong câu hỏi"
    data_source = state.get("data_source_context") if isinstance(state.get("data_source_context"), dict) else {}
    time_semantics = str(data_source.get("time_semantics") or data_source.get("time_semantics_vi") or "").strip()
    time_column = str(data_source.get("time_column") or "").strip()
    time_binding = str(stored.get("time_binding_vi") or "").strip()
    if not time_binding:
        time_binding = f"{time_column}: {time_semantics}".strip(": ") if time_column or time_semantics else "Dùng time_range đã chuẩn hóa từ supervisor."

    logical_steps = [str(x).strip() for x in (stored.get("logical_steps_vi") or []) if str(x).strip()]
    if not logical_steps:
        logical_steps = [
            f"Đọc bảng chính trong candidate pack: {', '.join(primary)}.",
            "Lọc theo time_range đã chuẩn hóa nếu báo cáo có thời gian.",
            f"Tính {metric_text} theo report_spec đã promote.",
        ]
        if group_by:
            logical_steps.append(f"Nhóm hoặc sắp xếp theo {group_by}.")
        logical_steps.append("Trả kết quả giới hạn an toàn để backend tiếp tục reviewer/trial.")

    return {
        "goal_vi": str(stored.get("goal_vi") or f"Chạy SQL Writer scenario đã promote: {asset.get('scenario_key') or ''}").strip(),
        "primary_tables": primary,
        "optional_tables": optional,
        "grain_vi": str(stored.get("grain_vi") or f"analysis_mode={analysis_mode}; group_by={group_by}; time_axis={time_axis}").strip(),
        "time_binding_vi": time_binding,
        "metric_plan_vi": [str(x).strip() for x in (stored.get("metric_plan_vi") or metrics) if str(x).strip()],
        "join_hints_vi": [str(x).strip() for x in (stored.get("join_hints_vi") or []) if str(x).strip()],
        "filter_hints_vi": [str(x).strip() for x in (stored.get("filter_hints_vi") or []) if str(x).strip()],
        "risk_notes_vi": [str(x).strip() for x in (stored.get("risk_notes_vi") or ["Scenario learned chỉ là blueprint; vẫn phải qua AST/RBAC/reviewer/trial."]) if str(x).strip()],
        "must_avoid_vi": [
            str(x).strip()
            for x in (
                stored.get("must_avoid_vi")
                or ["Không WITH/CTE", "Không UNION", "Không tự thêm outlet_id", "Không dùng bảng ngoài candidate pack"]
            )
            if str(x).strip()
        ],
        "logical_steps_vi": logical_steps[:12],
    }


def format_sql_plan_for_prompt(plan: dict[str, Any] | None) -> str:
    """Human-readable block for codegen_generator."""
    if not plan:
        return ""

    lines: list[str] = []
    goal = str(plan.get("goal_vi") or "").strip()
    if goal:
        lines.append(f"- Mục tiêu truy vấn: {goal}")

    pt = plan.get("primary_tables") or []
    ot = plan.get("optional_tables") or []
    if isinstance(pt, list) and pt:
        lines.append(f"- Bảng chính đề xuất: {', '.join(str(x) for x in pt[:8])}")
    if isinstance(ot, list) and ot:
        lines.append(f"- Bảng phụ / JOIN gợi ý: {', '.join(str(x) for x in ot[:8])}")

    grain = str(plan.get("grain_vi") or "").strip()
    if grain:
        lines.append(f"- Grain / chiều phân tích: {grain}")

    tb = str(plan.get("time_binding_vi") or "").strip()
    if tb:
        lines.append(f"- Thời gian & cột ngày dự kiến: {tb}")

    steps = plan.get("logical_steps_vi") or []
    if isinstance(steps, list) and steps:
        cleaned_steps = [str(x).strip() for x in steps if str(x).strip()]
        if cleaned_steps:
            lines.append("- **Các bước logic → một SELECT** (tuần tự):")
            for i, s in enumerate(cleaned_steps[:12], start=1):
                lines.append(f"  {i}. {s}")

    for field, label in (
        ("metric_plan_vi", "Đề xuất metric/cột aggregate"),
        ("join_hints_vi", "Gợi ý JOIN"),
        ("filter_hints_vi", "Gợi ý filter (không outlet_id)"),
        ("risk_notes_vi", "Rủi ro / lưu ý"),
        ("must_avoid_vi", "Phải tránh"),
    ):
        vals = plan.get(field) or []
        if isinstance(vals, list) and vals:
            cleaned = [str(x).strip() for x in vals if str(x).strip()]
            if cleaned:
                lines.append(f"- {label}: {'; '.join(cleaned[:10])}")

    if not lines:
        return ""

    return (
        "\n**Kế hoạch SQL (Planner — tuân thủ khi sinh proposed_sql):**\n"
        + "\n".join(lines)
        + "\n"
    )


async def codegen_sql_planner(state: GraphState) -> GraphState:
    normalized = effective_question(state)
    if not normalized:
        state.pop("codegen_sql_plan", None)
        state.setdefault("trace", []).append({"node": "codegen_sql_planner", "skipped": True, "reason": "empty"})
        return state

    learned = state.get("learned_sql_writer_scenario_asset")
    if isinstance(learned, dict) and learned:
        learned_candidates = _filter_allowed_tables(
            [
                *list(learned.get("dataset_candidates") or []),
                *list(learned.get("tables_used") or []),
            ]
        )
        if learned_candidates:
            state["codegen_candidate_tables"] = learned_candidates
            state["codegen_sql_plan"] = _learned_sql_writer_plan(state, candidate_tables=learned_candidates)
            state.setdefault("trace", []).append(
                {
                    "node": "codegen_sql_planner",
                    "source": "learned_sql_writer_scenario",
                    "scenario_key": learned.get("scenario_key"),
                }
            )
            return state

    if not get_settings().codegen_sql_plan_enabled:
        state.pop("codegen_sql_plan", None)
        state.setdefault("trace", []).append({"node": "codegen_sql_planner", "skipped": True, "reason": "disabled"})
        return state

    intent = state.get("intent")
    candidate_tables = candidate_tables_for_prompt(
        intent,
        question=normalized,
        max_tables=10,
        include_fallbacks=True,
    )
    state["codegen_candidate_tables"] = candidate_tables
    allowed_list = "\n".join(f"- {t}" for t in candidate_tables)
    time_range = state.get("time_range") or {}
    resolved = state.get("resolved_entities") or {}
    ctx = (state.get("conversation_context") or "").strip()
    ctx_block = f"\nNgữ cảnh:\n{ctx}\n" if ctx else ""

    outline = state.get("reasoning_outline")
    reasoning_block = format_reasoning_outline_for_matcher(outline if isinstance(outline, dict) else None)
    catalog_block = format_catalog_digest_for_prompt(state.get("catalog_digest"))
    metadata_block = format_metadata_context_for_prompt(state.get("metadata_context"))
    domain_block = "\n" + format_domain_contract(
        intent=intent,
        question=normalized,
        max_tables=10,
        include_fallbacks=True,
    ) + "\n"
    time_block = format_time_context_for_prompt(state.get("time_context"))
    coverage_block = format_data_coverage_for_prompt(state.get("data_coverage_context"))

    tmpl = state.get("template_key")
    tmpl_note = f"\nTemplate matcher gợi ý (tham khảo, không bắt buộc): {tmpl}\n" if tmpl else ""

    original = (state.get("normalized_question") or "").strip()
    original_block = f"Câu hỏi gốc: {original}\n" if original and original != normalized else ""

    user_prompt = f"""ALLOWED_TABLES:
{allowed_list}

{original_block}Câu hỏi hiệu lực: {normalized}
Supervisor intent: {intent}
Time range: {time_range}
Resolved entities: {resolved}
{time_block}{coverage_block}{domain_block}{tmpl_note}{metadata_block}{catalog_block}{reasoning_block}{ctx_block}

Trả về JSON plan: goal_vi, primary_tables, optional_tables, grain_vi, time_binding_vi,
metric_plan_vi, join_hints_vi, filter_hints_vi, risk_notes_vi, must_avoid_vi, logical_steps_vi.
"""

    try:
        parsed, usage = await llm_call_json(
            system_prompt=_SYSTEM,
            user_prompt=user_prompt,
            json_schema=_SQL_PLAN_SCHEMA,
            temperature=0.1,
            max_tokens=900,
            agent="sql_planner",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("codegen_sql_planner LLM failed: %s", e)
        state.pop("codegen_sql_plan", None)
        state.setdefault("trace", []).append({"node": "codegen_sql_planner", "skipped": True, "error": str(e)})
        return state

    candidate_set = set(candidate_tables)
    pt = _filter_allowed_tables(list(parsed.get("primary_tables") or []), allowed_subset=candidate_set)
    ot = _filter_allowed_tables(list(parsed.get("optional_tables") or []), allowed_subset=candidate_set)
    ot = [x for x in ot if x not in set(pt)]

    plan: dict[str, Any] = {
        "goal_vi": str(parsed.get("goal_vi") or "").strip(),
        "primary_tables": pt,
        "optional_tables": ot,
        "grain_vi": str(parsed.get("grain_vi") or "").strip(),
        "time_binding_vi": str(parsed.get("time_binding_vi") or "").strip(),
        "metric_plan_vi": [str(x).strip() for x in (parsed.get("metric_plan_vi") or []) if str(x).strip()],
        "join_hints_vi": [str(x).strip() for x in (parsed.get("join_hints_vi") or []) if str(x).strip()],
        "filter_hints_vi": [str(x).strip() for x in (parsed.get("filter_hints_vi") or []) if str(x).strip()],
        "risk_notes_vi": [str(x).strip() for x in (parsed.get("risk_notes_vi") or []) if str(x).strip()],
        "must_avoid_vi": [str(x).strip() for x in (parsed.get("must_avoid_vi") or []) if str(x).strip()],
        "logical_steps_vi": [str(x).strip() for x in (parsed.get("logical_steps_vi") or []) if str(x).strip()],
    }

    state["codegen_sql_plan"] = plan
    state.setdefault("trace", []).append({"node": "codegen_sql_planner", "agent": "sql_planning", **usage})
    return state
