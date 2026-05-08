"""Grounded documentation/definition reader.

iAnswers from query_policy semantic docs and curated system facts, enriched with
an LLM call to produce a clear, helpful explanation in natural Vietnamese.
"""

from __future__ import annotations

from datetime import datetime
import re

from app.graph.nodes.contextualizer import effective_question
from app.graph.state import GraphState
from app.llm.openai_client import llm_call_text
from app.query_policy import find_semantic_matches


_SYSTEM_DOCS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"\b(rbac|quyền|quyen|permission|role)\b", re.IGNORECASE),
        "RBAC của AI Query luôn được áp dụng programmatically từ user/outlet scope trước khi chạy SQL; LLM không được tự cấp quyền.",
    ),
    (
        re.compile(r"\b(cdc|đồng\s*bộ|dong\s*bo|clickhouse|lag)\b", re.IGNORECASE),
        "Dữ liệu phân tích được đồng bộ bất đồng bộ từ PostgreSQL qua CDC/Kafka sang ClickHouse; số liệu có thể trễ vài giây so với giao dịch vừa phát sinh.",
    ),
    (
        re.compile(r"\b(gensql|sql\s*writer|tự\s*viết\s*sql|tu\s*viet\s*sql)\b", re.IGNORECASE),
        "GenSQL chỉ được dùng trong allow-list, sau đó phải qua AST guard, RBAC injector, reviewer/trial và executor read-only.",
    ),
)

_DOCS_SYSTEM = """Bạn là FERN AI Query Assistant — chuyên gia nghiệp vụ F&B và hệ thống analytics.

Nhiệm vụ: Trả lời câu hỏi về định nghĩa/quy tắc/nghiệp vụ dựa trên Knowledge facts được cung cấp.

Quy tắc:
- Giải thích rõ ràng, dễ hiểu — như đang nói chuyện với quản lý vận hành, không phải kỹ thuật viên.
- Dùng ví dụ cụ thể từ ngành F&B khi phù hợp (ví dụ: giải thích AOV = doanh thu / số đơn).
- Nếu metric có công thức tính: nêu công thức ngắn gọn.
- Nếu metric liên quan đến bảng/nguồn dữ liệu: nhắc đến nhưng không cần ghi tên bảng kỹ thuật.
- Nếu Knowledge facts không đủ để trả lời đầy đủ: thành thật nói và gợi ý user hỏi gì thay.
- Ngắn gọn, súc tích. Tiếng Việt tự nhiên.
"""


def _build_knowledge_facts(question: str) -> tuple[list[str], list[str]]:
    """Return (display_lines, fact_lines_for_llm)."""
    display_lines: list[str] = []
    fact_lines: list[str] = []

    for hit in find_semantic_matches(question, max_items=6):
        if hit.get("kind") == "metric":
            display_lines.append(
                f"- `{hit['canonical_name']}`: {hit['definition_vi']} "
                f"(nguồn ưu tiên: `{hit['preferred_table']}`)."
            )
            fact_lines.append(
                f"Metric: {hit['canonical_name']} — {hit['definition_vi']} "
                f"(preferred_table: {hit['preferred_table']})."
            )
        elif hit.get("kind") == "value_alias":
            caveat = f" Lưu ý: {hit.get('caveat_vi')}" if hit.get("caveat_vi") else ""
            display_lines.append(f"- `{hit['canonical_name']}` tương ứng `{hit['filter_expression']}`.{caveat}")
            fact_lines.append(
                f"Alias: {hit['canonical_name']} = {hit['filter_expression']}.{caveat}"
            )

    for pattern, text in _SYSTEM_DOCS:
        if pattern.search(question):
            display_lines.append(f"- {text}")
            fact_lines.append(text)

    return display_lines, fact_lines


async def doc_reader(state: GraphState) -> GraphState:
    question = effective_question(state)
    display_lines, fact_lines = _build_knowledge_facts(question)

    if not fact_lines and state.get("metadata_context"):
        raw = str(state["metadata_context"])[:800]
        display_lines.append(raw)
        fact_lines.append(raw)

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if fact_lines:
        facts_text = "\n".join(fact_lines)
        user_prompt = (
            f"Câu hỏi: {question}\n\n"
            f"Knowledge facts:\n{facts_text}\n\n"
            f"Hãy trả lời câu hỏi trên bằng tiếng Việt, dựa trên facts đã cung cấp. "
            f"Thêm dòng nguồn dữ liệu ở cuối. Thời điểm hiện tại: {now}."
        )
        try:
            answer, _ = await llm_call_text(
                system_prompt=_DOCS_SYSTEM,
                user_prompt=user_prompt,
                temperature=0.3,
                max_tokens=500,
                agent="formatter",
            )
        except Exception:  # noqa: BLE001
            answer = "Mình tìm thấy các định nghĩa liên quan:\n" + "\n".join(display_lines[:6])
            answer += f"\n\n_Knowledge tính đến: {now}_"
    else:
        answer = (
            "Mình chưa có định nghĩa đã curate cho câu hỏi này. "
            "Bạn có thể hỏi về: doanh thu ròng, AOV, tỷ lệ hủy đơn, operating margin, "
            "tồn kho, RBAC, hoặc cách hệ thống đồng bộ dữ liệu."
            f"\n\n_Knowledge tính đến: {now}_"
        )

    state["answer_text"] = answer
    state["response_kind"] = "answer"
    state["template_key"] = None
    state["template_confidence"] = 1.0 if fact_lines else 0.0
    state["raw_result"] = []
    state["citations"] = [{"source": "query_policy_metadata", "row_count": len(display_lines)}]
    state["skip_answer_formatter_llm"] = True
    state.setdefault("trace", []).append({"node": "doc_reader", "hits": len(fact_lines)})
    return state
