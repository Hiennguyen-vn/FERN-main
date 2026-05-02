"""Pick best SQL template via OpenSearch + GPT-4.1."""
import logging

from app.clients.opensearch import hybrid_search_templates
from app.graph.state import GraphState
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
- Nếu không có template phù hợp HOẶC thiếu thông tin → template_key = null, missing_info liệt kê thông tin còn thiếu.
- confidence: 0..1.
"""


async def template_matcher(state: GraphState) -> GraphState:
    question = state["normalized_question"]
    intent = state.get("intent")
    time_range = state.get("time_range", {})
    resolved = state.get("resolved_entities", {})

    try:
        emb = await embed(question)
    except Exception as e:  # noqa: BLE001
        logger.warning("Embedding failed: %s", e)
        emb = None

    try:
        hits = hybrid_search_templates(text=question, embedding=emb, intent=intent, size=3)
    except Exception as e:  # noqa: BLE001
        logger.warning("OpenSearch templates failed, fallback to all: %s", e)
        hits = [{"template_key": k} for k in list_templates()[:5]]

    candidate_keys = [h.get("template_key") for h in hits if h.get("template_key") in TEMPLATES]
    if not candidate_keys:
        # Fallback: all 30 templates as candidates
        candidate_keys = list_templates()

    user_prompt = f"""Câu hỏi: {question}
Intent: {intent}
Time range: {time_range}
Resolved entities: {resolved}

Candidates (chọn 1):
{chr(10).join(f"- {k}: {TEMPLATES[k].required_params}" for k in candidate_keys)}
"""

    parsed, usage = await llm_call_json(
        system_prompt=_SYSTEM,
        user_prompt=user_prompt,
        json_schema=_schema(candidate_keys),
        temperature=0.1,
    )

    template_key = parsed.get("template_key")
    params = {k: v for k, v in (parsed.get("params") or {}).items() if v is not None}
    confidence = float(parsed.get("confidence", 0.0))

    # Fill defaults from time_range if matcher missed them
    if template_key and template_key in TEMPLATES:
        meta = TEMPLATES[template_key]
        for required in meta.required_params:
            if required not in params and required in time_range:
                params[required] = time_range[required]

    state["template_key"] = template_key
    state["template_params"] = params
    state["template_confidence"] = confidence
    if not template_key or confidence < 0.5:
        state["clarification_question"] = "Câu hỏi chưa đủ rõ. Bạn muốn xem chỉ số nào, trong khoảng thời gian nào?"
    state.setdefault("trace", []).append({"node": "template_matcher", **usage})
    return state
