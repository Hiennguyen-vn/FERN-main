"""Pure Python: normalize, sanitize, detect language."""
import re
import time
import unicodedata

from app.config import get_settings
from app.graph.state import GraphState


VIETNAMESE_DIACRITICS = re.compile(r"[ÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]")
# Whole-message social utterances (collapsed whitespace); avoids bypass on "chào + câu hỏi dài".
_SOCIAL_THANKS = re.compile(
    r"^(cảm\s+ơn(\s+(bạn|nhé|nha|ạ))?|cam\s+on(\s+(ban|nhe|nha|a))?|thanks|thank\s+you)(\s*[!.]*)?$",
    re.IGNORECASE,
)
_SOCIAL_GREETING = re.compile(
    r"^(xin\s+chào|chào(\s+(bạn|anh|chị|em|ad))?|hello|hi|hey)(\s*[!.]*)?$",
    re.IGNORECASE,
)

INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(previous|prior|above)", re.IGNORECASE),
    re.compile(r"system\s*[:\s]\s*you\s+are", re.IGNORECASE),
    re.compile(r"<\s*script", re.IGNORECASE),
    re.compile(r"--\s*\n", re.IGNORECASE),
    re.compile(r"/\*.*?\*/", re.DOTALL),
    re.compile(r"DROP\s+TABLE", re.IGNORECASE),
]


class PreprocessError(Exception):
    pass


def detect_standalone_social(text: str, *, max_len: int = 120) -> str | None:
    """Return greeting | thanks when the message is only smalltalk (no analytics mixed in)."""
    collapsed = " ".join(text.strip().split())
    if len(collapsed) > max_len:
        return None
    if _SOCIAL_THANKS.match(collapsed):
        return "thanks"
    if _SOCIAL_GREETING.match(collapsed):
        return "greeting"
    return None


def _format_conversation_context(turns: list[dict[str, str]] | None) -> str:
    if not turns:
        return ""
    lines: list[str] = []
    for t in turns[-6:]:
        role = (t.get("role") or "").strip().lower()
        content = (t.get("content") or "").strip()
        if not content:
            continue
        content = content[:4000]
        if role == "user":
            lines.append(f"User: {content}")
        elif role == "assistant":
            lines.append(f"Assistant: {content}")
    return "\n".join(lines)


def preprocess(state: GraphState) -> GraphState:
    state["workflow_perf_start_ns"] = time.perf_counter_ns()
    s = get_settings()
    raw = state["raw_question"]
    text = unicodedata.normalize("NFC", raw).strip()

    # Strip control chars except newline
    text = "".join(c for c in text if c == "\n" or unicodedata.category(c)[0] != "C")

    if len(text) > s.max_question_length:
        raise PreprocessError(f"Question too long ({len(text)} > {s.max_question_length})")
    if not text:
        raise PreprocessError("Empty question")

    state["normalized_question"] = text
    state["detected_language"] = "vi" if VIETNAMESE_DIACRITICS.search(text) else "en"
    turns = state.get("conversation_turns") or []
    state["conversation_context"] = _format_conversation_context(turns)

    for p in INJECTION_PATTERNS:
        if p.search(text):
            state["agent_route"] = "clarification"
            state["intent"] = "unknown"
            state["response_kind"] = "clarification"
            state["clarification_question"] = "Yêu cầu này không thể xử lý vì vi phạm chính sách an toàn truy vấn."
            state["template_key"] = None
            state["template_params"] = {}
            state["needs_sql_writer"] = False
            state.setdefault("trace", []).append({"node": "preprocess", "blocked": "disallowed_pattern"})
            return state

    sk = detect_standalone_social(text)
    if sk:
        state["social_kind"] = sk
    return state
