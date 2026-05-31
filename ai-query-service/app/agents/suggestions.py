"""Proactive follow-up suggestions — runs after reviewer_agent.

Suggestions are generated from ``analysis_brief`` (subject, entities, findings,
coverage), not from a static intent bucket. Keep this grounded: every suggestion
must preserve the subject of the result the user just saw.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.graph.state import GraphState

logger = logging.getLogger(__name__)


def _brief(state: GraphState) -> dict[str, Any]:
    value = state.get("analysis_brief")
    return value if isinstance(value, dict) else {}


def _entities(brief: dict[str, Any]) -> list[str]:
    subject = brief.get("subject") if isinstance(brief.get("subject"), dict) else {}
    out: list[str] = []
    for item in subject.get("entities") or []:
        text = str(item or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def _subject_type(brief: dict[str, Any], state: GraphState) -> str:
    subject = brief.get("subject") if isinstance(brief.get("subject"), dict) else {}
    value = str(subject.get("type") or "").strip()
    if value:
        return value
    return str(state.get("intent") or "analysis").strip()


def _primary_entity(brief: dict[str, Any], fallback: str) -> str:
    entities = _entities(brief)
    return entities[0] if entities else fallback


def _candidate_suggestions(state: GraphState) -> list[dict[str, str]]:
    brief = _brief(state)
    subject = _subject_type(brief, state)
    entity = _primary_entity(brief, "nhóm kết quả này")
    entities = _entities(brief)
    comparison = " và ".join(entities[:3]) if len(entities) >= 2 else entity

    if subject == "top_selling_products":
        return [
            {
                "question": f"{entity} còn đủ tồn kho theo snapshot mới nhất không?",
                "why": "Top bán chạy cần kiểm tra rủi ro đứt hàng.",
            },
            {
                "question": f"Biên lợi nhuận của {comparison} là bao nhiêu?",
                "why": "Sản phẩm bán tốt cần đối chiếu lợi nhuận, không chỉ số lượng.",
            },
            {
                "question": "Top sản phẩm bán chạy này tập trung ở outlet nào?",
                "why": "Xác định outlet đóng góp giúp phân bổ hàng và nhân sự.",
            },
        ]
    if subject == "slow_moving_products":
        return [
            {
                "question": f"{entity} đang tồn kho bao nhiêu theo snapshot mới nhất?",
                "why": "Bán chậm cộng tồn cao là rủi ro vốn tồn kho.",
            },
            {
                "question": f"{entity} bán chậm tập trung ở outlet nào?",
                "why": "Xác định outlet để xử lý trưng bày hoặc nhập hàng.",
            },
            {
                "question": f"Có nên giảm nhập hoặc chạy khuyến mãi cho {entity} không?",
                "why": "Gợi ý hành động dựa trên tốc độ bán và tồn kho.",
            },
        ]
    if subject == "outlet_performance":
        return [
            {
                "question": f"{entity} mạnh/yếu ở nhóm sản phẩm nào?",
                "why": "Đào sâu nguyên nhân chênh lệch doanh thu giữa outlet.",
            },
            {
                "question": f"AOV và số giao dịch của {entity} thay đổi thế nào?",
                "why": "Tách doanh thu thành ticket size và số lượt mua.",
            },
            {
                "question": "Top 3 outlet trong kết quả khác nhau ở phương thức thanh toán nào?",
                "why": "Kiểm tra mix thanh toán có ảnh hưởng vận hành hay không.",
            },
        ]
    if subject == "inventory_snapshot":
        return [
            {
                "question": f"{entity} có phát sinh bán hàng trong kỳ gần nhất không?",
                "why": "Kết nối tồn kho với tốc độ bán để phát hiện thừa/thiếu hàng.",
            },
            {
                "question": "Những item tồn thấp này nằm ở outlet nào?",
                "why": "Cần biết điểm bán để điều chuyển hoặc nhập bổ sung.",
            },
            {
                "question": "Có item nào tồn âm cần kiểm tra kiểm kê không?",
                "why": "Tồn âm thường là lỗi vận hành hoặc đồng bộ.",
            },
        ]

    metric_text = ""
    key_numbers = brief.get("key_numbers") if isinstance(brief.get("key_numbers"), list) else []
    if key_numbers:
        metric_text = str((key_numbers[0] or {}).get("metric") or "").strip()
    metric_label = metric_text or "chỉ số này"
    return [
        {
            "question": f"{metric_label} này tách theo outlet thế nào?",
            "why": "Drill-down theo outlet giúp tìm điểm đóng góp chính.",
        },
        {
            "question": "So với kỳ liền trước thì kết quả này tăng hay giảm?",
            "why": "So sánh kỳ trước giúp đánh giá xu hướng.",
        },
        {
            "question": "Yếu tố nào đóng góp nhiều nhất vào kết quả này?",
            "why": "Tìm driver chính trước khi ra quyết định.",
        },
    ]


def _valid_suggestion(question: str, state: GraphState) -> bool:
    brief = _brief(state)
    guardrails = brief.get("guardrails") if isinstance(brief.get("guardrails"), dict) else {}
    lowered = question.lower()
    for term in guardrails.get("avoid_terms") or []:
        if str(term or "").lower() in lowered:
            return False
    subject = _subject_type(brief, state)
    if subject == "top_selling_products" and ("bán chậm" in lowered or "slow" in lowered):
        return False
    if subject == "slow_moving_products" and "bán chạy nhất" in lowered:
        return False
    return True


def _suggest_for_state(state: GraphState, max_n: int) -> list[str]:
    rk = state.get("response_kind")
    if rk in {"clarification", "unsupported"}:
        return []
    if state.get("social_kind") or state.get("agent_route") in {"social", "greeting", "thanks"}:
        return []
    if state.get("intent") == "lookup" or state.get("template_key") in {"T31_outlet_directory", "T37_ai_sales_daily_outlets"}:
        return []
    rows = state.get("raw_result") or []
    if not rows:
        return []

    pool: list[str] = []
    rationales: list[dict[str, str]] = []
    for candidate in _candidate_suggestions(state):
        question = str(candidate.get("question") or "").strip()
        if not question or question in pool or not _valid_suggestion(question, state):
            continue
        pool.append(question)
        rationales.append({"question": question, "why": str(candidate.get("why") or "").strip()})
        if len(pool) >= max_n:
            break

    # If we already exported a file, skip the export suggestion.
    exports = state.get("exports") or []
    if exports:
        pool = [s for s in pool if "xuất file" not in s.lower() and "csv" not in s.lower()]

    if rationales:
        state["suggestion_rationales"] = [item for item in rationales if item.get("question") in pool]
    return pool[:max_n]


def suggestions_node(state: GraphState) -> GraphState:
    s = get_settings()
    if not s.followup_suggestions_enabled:
        return state
    try:
        max_n = max(1, int(s.followup_max_suggestions))
        suggestions = _suggest_for_state(state, max_n)
    except Exception as e:  # noqa: BLE001
        logger.warning("Suggestions node failed (best-effort skip): %s", e)
        return state
    if suggestions:
        state["suggestions"] = suggestions
        state.setdefault("trace", []).append({"node": "suggestions", "count": len(suggestions)})
    return state
