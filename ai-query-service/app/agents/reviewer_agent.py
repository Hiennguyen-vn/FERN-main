"""Reviewer Agent — quality guard that critiques the formatter's answer.

Runs after answer_formatter as a single LLM call (no tools). Acts as a
senior analyst reviewing a junior's draft: checks number consistency,
missing caveats, leaked internals, and tone. Can return a revised answer
which we apply when the verdict is ``minor_revision`` (small fixes only).

Skipped (kept fast) for:
  - clarification / unsupported / social responses
  - empty results that already have a coverage caveat
  - feature flag REVIEWER_AGENT_ENABLED=false
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.config import get_settings
from app.graph.state import GraphState
from app.llm.openai_client import llm_call_json

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """Bạn là Senior Analyst review câu trả lời do agent junior soạn cho user nội bộ FERN (chuỗi F&B).

Nhiệm vụ: kiểm tra DRAFT_ANSWER trên các tiêu chí sau và trả về JSON.

TIÊU CHÍ KIỂM TRA:
1. number_consistency: Mọi con số trong DRAFT_ANSWER phải khớp với answer_facts (numeric_totals, preview_rows, scope_facts, source_context). Nếu DRAFT đưa ra số không có nguồn → flag.
2. missing_caveat: Nếu coverage_status là "outside" / "partial_*" hoặc có caveat trong source_context, DRAFT phải nhắc → nếu thiếu thì flag.
3. wrong_metric: net_revenue vs gross_revenue, weighted vs simple average, growth không có baseline rõ — nếu DRAFT dùng sai loại → flag.
4. leak: Nếu DRAFT lộ tên template_key (T01_*, T22_*), từ "SQL", "prompt", "reviewer", "pipeline" → flag.
5. tone: Câu trả lời có rõ ràng, có kết luận đầu, có nguồn dữ liệu cuối không.
6. list_completeness: Nếu answer_facts có preview_includes_all_rows=true (hoặc row_count == len(preview_rows)) và câu hỏi là xếp hạng/danh sách — DRAFT không được bỏ bớt hạng so với preview_rows trừ khi đang sửa lỗi số liệu sai.
7. table_format: Nếu DRAFT_ANSWER có bảng markdown, hoặc answer_facts là danh sách/xếp hạng/so sánh nhiều dòng, bảng phải parseable: header row, separator row `|---|---|`, mọi dòng cùng số cột, bảng đứng riêng, không nằm trong code fence. Nếu junior dùng numbered list kiểu `key=value` cho dữ liệu nhiều dòng có thể thành bảng → flag table_format mức low/medium và sửa thành bảng.

QUYẾT ĐỊNH (verdict):
- "approve": không có issue nào hoặc chỉ có issue severity=low không ảnh hưởng dữ liệu.
- "minor_revision": có 1–2 issue về tone/caveat/leak nhẹ, có thể tự sửa nhanh — TRẢ revised_answer_vi đã sửa.
- "major_revision": phát hiện number_mismatch hoặc wrong_metric — TRẢ revised_answer_vi giữ nguyên cấu trúc nhưng sửa chỗ sai. KHÔNG bịa số mới — chỉ dùng số có trong answer_facts.

QUY TẮC TUYỆT ĐỐI:
- Không bịa số. Không thay đổi metric/dimension nếu không chắc chắn.
- ID/phạm vi trong scope_facts/source_context (outlet_id, ngày, row_count, allowed_outlet_count) là nguồn hợp lệ; không flag chỉ vì số đó không nằm trong preview_rows.
- Nếu không chắc → để verdict="approve" và note severity=low.
- revised_answer_vi (nếu có) phải hoàn chỉnh, sẵn sàng gửi user — không được dạng diff/patch.
- Khi revised_answer_vi có dữ liệu dạng bảng/ranking/breakdown, phải giữ hoặc chuyển sang markdown table chuẩn parseable; không phá header/separator của bảng.
- confidence là độ tự tin vào verdict, không phải vào câu trả lời.
"""


_REVIEWER_SCHEMA: dict[str, Any] = {
    "name": "reviewer_verdict",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "verdict": {"type": "string", "enum": ["approve", "minor_revision", "major_revision"]},
            "issues": {
                "type": "array",
                "maxItems": 5,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                        "kind": {
                            "type": "string",
                            "enum": [
                                "number_mismatch",
                                "missing_caveat",
                                "wrong_metric",
                                "leak",
                                "tone",
                                "table_format",
                                "other",
                            ],
                        },
                        "note_vi": {"type": "string"},
                    },
                    "required": ["severity", "kind", "note_vi"],
                },
            },
            "revised_answer_vi": {"type": ["string", "null"]},
            "confidence": {"type": "number"},
        },
        "required": ["verdict", "issues", "revised_answer_vi", "confidence"],
    },
}


_DETERMINISTIC_INSIGHT_PREFIXES = ("INS_", "ANOM_", "FORECAST_")
_DETERMINISTIC_LOOKUP_TEMPLATES = {"T31_outlet_directory", "T37_ai_sales_daily_outlets", "T38_product_directory"}
_DETERMINISTIC_FORMATTER_SOURCES = {
    "deterministic_top_product_revenue_by_outlet",
    "deterministic_top_category_revenue_by_region",
    "deterministic_top_qty_not_top_revenue",
    "deterministic_codegen_product_revenue_by_outlet",
    "deterministic_codegen_product_revenue_summary",
}


def _should_skip(state: GraphState) -> tuple[bool, str]:
    s = get_settings()
    if not s.reviewer_agent_enabled:
        return True, "flag_off"
    template_key = str(state.get("template_key") or "")
    if template_key.startswith(_DETERMINISTIC_INSIGHT_PREFIXES):
        return True, "deterministic_insight"
    if template_key in _DETERMINISTIC_LOOKUP_TEMPLATES or state.get("intent") == "lookup":
        return True, "deterministic_lookup"
    trace = state.get("trace") or []
    if any(
        isinstance(item, dict)
        and item.get("node") == "answer_formatter"
        and str(item.get("source") or "") in _DETERMINISTIC_FORMATTER_SOURCES
        for item in trace
    ):
        return True, "deterministic_formatter"
    rk = state.get("response_kind")
    if rk in {"clarification", "unsupported"}:
        return True, "non_data_response"
    if state.get("social_kind"):
        return True, "social"
    if state.get("skip_answer_formatter_llm") and not state.get("raw_result"):
        return True, "preset_or_empty"
    answer = state.get("answer_text") or ""
    if len(answer.strip()) < 20:
        return True, "answer_too_short"
    return False, ""


def _safe_facts(state: GraphState) -> dict[str, Any]:
    s = get_settings()
    cap = max(1, int(s.reviewer_answer_facts_max_rows))
    rows = state.get("raw_result") or []
    preview = rows[:cap]
    first = rows[0] if rows and isinstance(rows[0], dict) else {}
    numeric_cols = [
        k for k, v in first.items()
        if isinstance(v, (int, float)) and not str(k).lower().endswith("_id")
    ][:8]
    totals: dict[str, float] = {}
    for col in numeric_cols:
        total = 0.0
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                total += float(row.get(col) or 0)
            except (TypeError, ValueError):
                pass
        totals[col] = total
    ds = state.get("data_source_context") or {}
    allowed = state.get("allowed_outlet_ids") or []
    allowed_count = len(allowed) if isinstance(allowed, list) else 0
    scoped_outlets = allowed[: min(len(allowed), 50)] if isinstance(allowed, list) else []
    time_range = state.get("time_range") if isinstance(state.get("time_range"), dict) else {}
    return {
        "row_count": len(rows),
        "allowed_outlet_count": allowed_count,
        "preview_row_count": len(preview),
        "preview_includes_all_rows": len(rows) <= cap,
        "numeric_totals": totals,
        "preview_rows": [
            {k: row.get(k) for k in list(row.keys())[:16]} if isinstance(row, dict) else {}
            for row in preview
        ],
        "scope_facts": {
            "template_key": state.get("template_key"),
            "intent": state.get("intent"),
            "time_range": time_range,
            "allowed_outlet_ids": scoped_outlets,
            "allowed_outlet_count": allowed_count,
        },
        "coverage_status": ds.get("coverage_status"),
        "primary_dataset": ds.get("primary_dataset"),
        "source_context": {
            "requested_range": ds.get("requested_range") or {},
            "available_range": ds.get("available_range") or {},
            "actual_data_range": ds.get("actual_data_range") or {},
        },
        "caveats": ds.get("caveats") or [],
    }


async def reviewer_agent(state: GraphState) -> GraphState:
    skip, reason = _should_skip(state)
    if skip:
        state.setdefault("trace", []).append({"node": "reviewer_agent", "skipped": True, "reason": reason})
        return state

    try:
        s = get_settings()
        question_frame = state.get("question_frame") or {}
        question = str(question_frame.get("effective_question") or state.get("normalized_question") or state.get("raw_question") or "")
        draft = state.get("answer_text") or ""
        facts = _safe_facts(state)

        user_prompt = (
            f"Câu hỏi: {question}\n\n"
            f"answer_facts:\n{json.dumps(facts, ensure_ascii=False, default=str)}\n\n"
            f"DRAFT_ANSWER:\n{draft}\n\n"
            f"Trả về JSON đúng schema reviewer_verdict."
        )

        verdict, _ = await llm_call_json(
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            json_schema=_REVIEWER_SCHEMA,
            temperature=0.1,
            max_tokens=min(8000, int(s.reviewer_max_tokens) + len(facts.get("preview_rows") or []) * 8),
            agent="reviewer",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Reviewer agent failed (best-effort skip): %s", e)
        state.setdefault("trace", []).append({"node": "reviewer_agent", "error": type(e).__name__})
        return state

    decision = str(verdict.get("verdict") or "approve").lower()
    issues = verdict.get("issues") or []
    revised = verdict.get("revised_answer_vi")
    confidence = float(verdict.get("confidence") or 0.0)

    quality = {
        "verdict": decision,
        "issues": issues,
        "confidence": confidence,
        "applied_revision": False,
    }

    if decision in ("minor_revision", "major_revision") and isinstance(revised, str) and revised.strip():
        # Apply revision; keep original text in trace for audit.
        state["answer_text"] = revised.strip() + "\n\n_Đã được Reviewer rà soát._"
        quality["applied_revision"] = True

    state["quality_report"] = quality
    state.setdefault("trace", []).append(
        {"node": "reviewer_agent", "verdict": decision, "issue_count": len(issues), "applied": quality["applied_revision"]}
    )
    return state
