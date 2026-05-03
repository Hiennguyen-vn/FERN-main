"""Pure Python: normalize, sanitize, detect language."""
import re
import unicodedata

from app.config import get_settings
from app.graph.state import GraphState


VIETNAMESE_DIACRITICS = re.compile(r"[ÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]")
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
    s = get_settings()
    raw = state["raw_question"]
    text = unicodedata.normalize("NFC", raw).strip()

    # Strip control chars except newline
    text = "".join(c for c in text if c == "\n" or unicodedata.category(c)[0] != "C")

    if len(text) > s.max_question_length:
        raise PreprocessError(f"Question too long ({len(text)} > {s.max_question_length})")
    if not text:
        raise PreprocessError("Empty question")

    for p in INJECTION_PATTERNS:
        if p.search(text):
            raise PreprocessError("Question contains disallowed pattern")

    state["normalized_question"] = text
    state["detected_language"] = "vi" if VIETNAMESE_DIACRITICS.search(text) else "en"
    turns = state.get("conversation_turns") or []
    state["conversation_context"] = _format_conversation_context(turns)
    return state
