"""Pick best SQL template via OpenSearch + GPT-4.1."""
import logging

from app.clients.opensearch import hybrid_search_templates
from app.graph.state import GraphState
from app.knowledge.lexicon import format_lexicon_hints
from app.llm.openai_client import embed, llm_call_json
from app.templates.registry import TEMPLATES, list_templates

logger = logging.getLogger(__name__)


def _schema(allowed_keys: list[str]) -> dict:
    return {
        "name": "template_match_result",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "template_key": {"type": ["string", "null"], "enum": [*allowed_keys, None]},
                "params": {
                    "type": "object",
                    "properties": {
                        "from_date": {"type": ["string", "null"]},
                        "to_date": {"type": ["string", "null"]},
                        "limit": {"type": ["integer", "null"]},
                        "threshold": {"type": ["integer", "null"]},
                    },
                    "required": ["from_date", "to_date", "limit", "threshold"],
                    "additionalProperties": False,
                },
                "confidence": {"type": "number"},
                "missing_info": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["template_key", "params", "confidence", "missing_info"],
            "additionalProperties": False,
        },
    }


_SYSTEM = """Bạn là Template Matcher cho AI Query Assistant của FERN.

NHIỆM VỤ: chọn 1 template_key phù hợp nhất từ danh sách candidates được cung cấp.

QUY TẮC NGHIÊM NGẶT:
- KHÔNG sinh SQL mới. Chỉ chọn template_key từ danh sách.
- Fill params từ time_range và resolved_entities được cung cấp.
- KHÔNG đặt outlet_id vào params (backend tự inject).
- Date format: YYYY-MM-DD.
- Nếu không có template phù hợp HOẶC thiếu thông tin → template_key = null, missing_info liệt kê thông tin còn thiếu (tiếng Việt hoặc tiếng Anh ngắn).
- confidence: 0..1.
- Ưu tiên khớp câu hỏi với **mục đích nghiệp vụ** trong khối "Gợi ý nghiệp vụ" (nếu có).
"""


HR_UNSUPPORTED = (
    "AI Analyst hiện **chưa hỗ trợ** tra cứu danh sách nhân viên, ca làm hay hồ sơ HR. "
    "Bạn có thể dùng module Nhân sự trên hệ thống FERN, "
    "hoặc hỏi các báo cáo vận hành/kinh doanh trong phạm vi doanh thu, tồn kho, sản phẩm."
)


def _missing_info_message(missing: list[str]) -> str | None:
    cleaned = [str(m).strip() for m in missing if str(m).strip()]
    if not cleaned:
        return None
    return "Để chạy báo cáo, cần thêm:\n• " + "\n• ".join(cleaned[:10])


def _clarification_for_failed_match(state: GraphState, missing_info: list[str]) -> tuple[str, str, list[str]]:
    """Returns (question_text, response_kind, hints)."""
    intent = state.get("intent") or "unknown"
    if intent == "export_request":
        return (
            "Xuất file **Excel/CSV** tự động chưa được bật trong phiên bản này. "
            "Bạn hãy mô tả báo cáo cần xem (ví dụ: doanh thu 7 ngày theo cửa hàng, "
            "tỷ lệ hủy đơn, tồn kho thấp...) kèm **khoảng thời gian** — số liệu sẽ hiển thị tại đây.",
            "clarification",
            [*missing_info],
        )

    hinted = _missing_info_message(missing_info)
    if hinted:
        return hinted, "clarification", [*missing_info]

    return (
        "Hiện chưa chọn được báo cáo phù hợp trong danh mục hỗ trợ (doanh thu, tồn kho, "
        "sản phẩm, hiệu suất cửa hàng…). "
        "Bạn muốn xem **chỉ số cụ thể nào** và trong **khoảng thời gian** nào?",
        "clarification",
        [],
    )


async def template_matcher(state: GraphState) -> GraphState:
    question = state["normalized_question"]
    intent = state.get("intent")
    time_range = state.get("time_range", {})
    resolved = state.get("resolved_entities", {})

    # HR không có trong registry template — không gọi LLM matcher để khỏi bị “hỏi lại chỉ số/thời gian” sai nghĩa.
    if intent == "hr_staff":
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = 0.0
        state["matcher_missing_info"] = []
        state["response_hints"] = []
        state["response_kind"] = "unsupported"
        state["clarification_question"] = HR_UNSUPPORTED
        state.setdefault("trace", []).append({"node": "template_matcher", "skipped": "hr_staff"})
        return state

    try:
        emb = await embed(question)
    except Exception as e:  # noqa: BLE001
        logger.warning("Embedding failed: %s", e)
        emb = None

    # export_request không có template riêng — dùng cùng chỉ số POS/revenue/inventory.
    os_intent = None if intent == "export_request" else intent
    try:
        hits = hybrid_search_templates(text=question, embedding=emb, intent=os_intent, size=3)
    except Exception as e:  # noqa: BLE001
        logger.warning("OpenSearch templates failed, falling back to full template list: %s", e)
        hits = []

    candidate_keys = [h.get("template_key") for h in hits if h.get("template_key") in TEMPLATES]
    if not candidate_keys:
        # OpenSearch unavailable or returned no usable hits — use all templates so
        # the LLM can still pick the best match rather than being limited to 5.
        candidate_keys = list_templates()

    ctx = (state.get("conversation_context") or "").strip()
    ctx_block = f"\nNgữ cảnh hội thoại gần đây:\n{ctx}\n" if ctx else ""

    user_prompt = f"""Câu hỏi hiện tại: {question}
{ctx_block}
Intent supervisor: {intent}
Time range: {time_range}
Resolved entities: {resolved}

Candidates (chọn 1):
{chr(10).join(f"- {k}: {TEMPLATES[k].required_params}" for k in candidate_keys)}
"""

    lex_block = format_lexicon_hints(candidate_keys)
    matcher_system = _SYSTEM
    if lex_block:
        matcher_system += "\n\nGợi ý nghiệp vụ (chọn template phù hợp nhất):\n" + lex_block

    parsed, usage = await llm_call_json(
        system_prompt=matcher_system,
        user_prompt=user_prompt,
        json_schema=_schema(candidate_keys),
        temperature=0.1,
    )

    template_key = parsed.get("template_key")
    params = {k: v for k, v in (parsed.get("params") or {}).items() if v is not None}
    confidence = float(parsed.get("confidence", 0.0))
    missing_info_raw = parsed.get("missing_info") or []
    missing_info: list[str] = [str(x).strip() for x in missing_info_raw if str(x).strip()]
    state["matcher_missing_info"] = missing_info

    # Fill defaults from time_range if matcher missed them
    if template_key and template_key in TEMPLATES:
        meta = TEMPLATES[template_key]
        for required in meta.required_params:
            if not params.get(required) and required in time_range:
                params[required] = time_range[required]

    state["template_key"] = template_key
    state["template_params"] = params
    state["template_confidence"] = confidence
    if not template_key or confidence < 0.5:
        text, kind, hints = _clarification_for_failed_match(state, missing_info)
        state["clarification_question"] = text
        state["response_kind"] = kind
        state["response_hints"] = hints
    state.setdefault("trace", []).append({"node": "template_matcher", **usage})
    return state
