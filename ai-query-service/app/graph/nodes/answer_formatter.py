"""GPT-4.1: format Vietnamese natural-language answer from raw_result."""
from datetime import datetime

from app.graph.state import GraphState
from app.llm.openai_client import llm_call_text


_SYSTEM = """Bạn là Answer Formatter cho FERN AI Query Assistant.

NHIỆM VỤ: viết câu trả lời tiếng Việt ngắn gọn, có số liệu cụ thể.

YÊU CẦU:
- Format số tiền VND với dấu phân cách hàng nghìn, đơn vị "đ" hoặc "VNĐ".
- Bao gồm: chỉ số chính, thời gian, scope (nếu có).
- Nếu không có dữ liệu: nói rõ "Không có dữ liệu trong khoảng thời gian này".
- Cuối cùng thêm dòng: "_Dữ liệu tính đến: {timestamp}_"
- Tối đa 5 dòng.
"""


def _refusal(state: GraphState) -> str:
    errors = state.get("validation_errors") or []
    violations = state.get("guard_violations") or []
    clarification = state.get("clarification_question")

    if clarification:
        return clarification
    if any("Role insufficient" in e for e in errors):
        return "Bạn không có quyền xem báo cáo này. Vui lòng liên hệ quản lý."
    if any("No allowed outlets" in e for e in errors):
        return "Phạm vi outlet không hợp lệ với câu hỏi của bạn."
    if errors:
        return f"Câu hỏi chưa đủ thông tin: {', '.join(errors[:3])}."
    if violations:
        return "Yêu cầu của bạn không thể xử lý do vi phạm chính sách bảo mật."
    return "Xin lỗi, tôi không xử lý được câu hỏi này. Bạn có thể diễn đạt lại không?"


async def answer_formatter(state: GraphState) -> GraphState:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Refusal paths
    if state.get("validation_errors") or not state.get("guard_passed", True) or state.get("execution_error"):
        if state.get("execution_error") and state.get("correction_attempts", 0) >= 2:
            state["answer_text"] = "Có lỗi khi truy xuất dữ liệu. Vui lòng thử lại sau."
        else:
            state["answer_text"] = _refusal(state)
        state["citations"] = []
        return state

    rows = state.get("raw_result") or []
    if not rows:
        state["answer_text"] = f"Không có dữ liệu phù hợp.\n\n_Dữ liệu tính đến: {now}_"
        state["citations"] = []
        return state

    # Limit rows in prompt to avoid token blow-up
    sample = rows[:30]
    user_prompt = f"""Câu hỏi: {state.get('normalized_question', '')}
Template: {state.get('template_key')}
Số dòng kết quả: {len(rows)}
Mẫu dữ liệu (tối đa 30 dòng):
{sample}

Viết câu trả lời tiếng Việt theo yêu cầu hệ thống. Thời gian hiện tại: {now}.
"""

    text, usage = await llm_call_text(
        system_prompt=_SYSTEM,
        user_prompt=user_prompt,
        temperature=0.3,
    )
    state["answer_text"] = text
    state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
    state.setdefault("trace", []).append({"node": "answer_formatter", **usage})
    return state
