"""Short conversational replies (greeting / thanks) — no ClickHouse or templates."""

from datetime import date

from app.graph.state import GraphState


def _fallback_entities() -> dict[str, list[str]]:
    return {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []}


def social_reply(state: GraphState) -> GraphState:
    """Fill answer_text for greeting/thanks; defaults so API fields stay consistent."""
    today = date.today().isoformat()
    kind = (state.get("social_kind") or "").strip().lower()
    intent = (state.get("intent") or "").strip().lower()

    if kind not in ("greeting", "thanks"):
        if intent == "greeting":
            kind = "greeting"
        elif intent == "thanks":
            kind = "thanks"
        else:
            kind = "greeting"

    state["intent"] = kind
    state["agent_route"] = kind
    state.setdefault("time_range", {"from_date": today, "to_date": today})
    state.setdefault("raw_entities", _fallback_entities())
    state.setdefault("resolved_entities", {})

    if kind == "thanks":
        text = (
            "Không có gì — rất vui được hỗ trợ bạn.\n\n"
            "Khi cần xem số liệu, bạn có thể hỏi ví dụ: **doanh thu 7 ngày theo cửa hàng**, "
            "**tồn kho thấp**, **top sản phẩm bán chạy**, hoặc **nhân viên đi làm nhiều nhất tuần này** "
            "(nhớ ghi khoảng thời gian nếu cần)."
        )
    else:
        text = (
            "Chào bạn — mình là AI Analyst của FERN.\n\n"
            "Mình có thể giúp bạn xem **doanh thu**, **tồn kho**, **sản phẩm / cửa hàng**, "
            "**chấm công** và **lương nhân viên** trong phạm vi quyền của bạn.\n\n"
            "Bạn muốn xem báo cáo **nào** và trong **khoảng thời gian** nào?"
        )

    state["answer_text"] = text
    state["response_kind"] = "answer"
    state["skip_answer_formatter_llm"] = True
    state["template_key"] = None
    state["template_confidence"] = 0.0
    state["citations"] = []
    state.setdefault("trace", []).append({"node": "social_reply", "social_kind": kind})
    return state
