"""GPT-4.1: extract intent, time_range, raw_entities."""
from datetime import date

from app.graph.state import GraphState
from app.llm.openai_client import llm_call_json


SUPERVISOR_SCHEMA = {
    "name": "supervisor_result",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "intent": {
                "type": "string",
                "enum": ["revenue", "inventory", "product_mix", "pnl", "outlet_compare", "trend", "lookup", "unknown"],
            },
            "confidence": {"type": "number"},
            "time_range": {
                "type": "object",
                "properties": {
                    "from_date": {"type": "string"},
                    "to_date": {"type": "string"},
                },
                "required": ["from_date", "to_date"],
                "additionalProperties": False,
            },
            "raw_entities": {
                "type": "object",
                "properties": {
                    "outlet_names": {"type": "array", "items": {"type": "string"}},
                    "product_names": {"type": "array", "items": {"type": "string"}},
                    "categories": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["outlet_names", "product_names", "categories"],
                "additionalProperties": False,
            },
        },
        "required": ["intent", "confidence", "time_range", "raw_entities"],
        "additionalProperties": False,
    },
}


def _system_prompt() -> str:
    today = date.today().isoformat()
    return f"""Bạn là Supervisor cho AI Query Assistant của hệ thống F&B FERN.

Hôm nay là {today}. Phân tích câu hỏi và trả về JSON với:

1. intent (1 trong 8):
   - revenue: hỏi doanh thu, doanh số
   - inventory: hỏi tồn kho, nguyên liệu
   - product_mix: hỏi top sản phẩm, sản phẩm bán chạy/chậm
   - pnl: hỏi lãi/lỗ, P&L, chi phí
   - outlet_compare: so sánh giữa các outlet
   - trend: hỏi xu hướng theo thời gian
   - lookup: tra cứu thông tin (giá, địa chỉ)
   - unknown: không rõ ý định

2. time_range: ISO date YYYY-MM-DD
   - "hôm nay" → from=to={today}
   - "hôm qua" → from=to=(today-1)
   - "tuần này" → from=monday(today), to={today}
   - "tháng này" → from=01 tháng hiện tại, to={today}
   - "tháng trước" → toàn bộ tháng trước
   - Nếu không có thời gian rõ → from=to={today}

3. raw_entities: tên outlet, sản phẩm, danh mục được đề cập (chuỗi gốc).

confidence: 0..1.
"""


async def supervisor(state: GraphState) -> GraphState:
    parsed, usage = await llm_call_json(
        system_prompt=_system_prompt(),
        user_prompt=state["normalized_question"],
        json_schema=SUPERVISOR_SCHEMA,
        temperature=0.1,
    )
    state["intent"] = parsed["intent"]
    state["time_range"] = parsed["time_range"]
    state["raw_entities"] = parsed["raw_entities"]
    state.setdefault("trace", []).append({"node": "supervisor", **usage})
    return state
