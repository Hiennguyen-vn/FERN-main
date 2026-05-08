"""Conversation contextualizer.

This is a cheap, deterministic equivalent of a Finch-style question rewrite
stage: short follow-up turns are converted into a standalone effective question
before Supervisor / retrieval / SQL agents run.
"""
from __future__ import annotations

import re
import unicodedata

from app.graph.state import GraphState
from app.time_utils import has_time_expression, is_time_followup

_SHORT_FILTER_RE = re.compile(
    r"^\s*(còn\s+|con\s+|vậy\s+|vay\s+|thế\s+|the\s+|ở\s+|o\s+)?"
    r"((?:outlet|cửa\s*hàng|cua\s*hang|chi\s*nhánh|chi\s*nhanh)\s+"
    r"(?:[A-Z]{2,}(?:-[A-Z0-9]+){1,}|\d{1,4}|[A-Za-zÀ-ỹ0-9 .-]{2,50})|"
    r"khu\s*vực\s+[A-Za-zÀ-ỹ0-9 .-]{2,50}|khu\s*vuc\s+[A-Za-zÀ-ỹ0-9 .-]{2,50}|"
    r"part\s*-?\s*time|parttime|full\s*-?\s*time|fulltime|"
    r"[A-Z]{2,}(?:-[A-Z0-9]+){1,})\s*[?!.]*\s*$",
    re.IGNORECASE,
)
_PAYROLL_PREVIOUS_RE = re.compile(r"(lương|luong|payroll|salary|thu\s*nhập|thu\s*nhap)", re.IGNORECASE)
_PRODUCT_INVENTORY_CONTEXT_RE = re.compile(
    r"(sản\s*phẩm|san\s*pham|product|tồn\s*kho|ton\s*kho|inventory|"
    r"bán\s*chậm|ban\s*cham|slow\s*moving|mặt\s*hàng|mat\s*hang|sku|"
    r"hàng\s*tồn|hang\s*ton)",
    re.IGNORECASE,
)
_NAME_ONLY_RE = re.compile(r"^\s*[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ0-9_. -]{1,78}\s*[?!.]*\s*$")
_HR_CONTEXT_RE = re.compile(
    r"(nhân\s*viên|nhan\s*vien|employee|staff|chấm\s*công|cham\s*cong|"
    r"đi\s*làm|di\s*lam|làm\s*việc|lam\s*viec|giờ\s*làm|gio\s*lam|"
    r"giờ\s*công|gio\s*cong|tổng\s*giờ|tong\s*gio|bao\s*nhiêu\s*giờ|bao\s*nhieu\s*gio|"
    r"work\s*hours?|working\s*hours?|lương|luong|payroll|salary|thâm\s*niên|tham\s*nien)",
    re.IGNORECASE,
)
_HR_EMPLOYEE_SELECTION_RE = re.compile(
    r"(\b[A-Z0-9-]*EMP[A-Z0-9-]*\b|username\s+[A-Za-z0-9_.-]+|"
    r"(?:giờ\s*làm|gio\s*lam|giờ\s*công|gio\s*cong|lương|luong|payroll|salary)\s+(?:của|cua|cho)|"
    r"(?:nhân\s*viên|nhan\s*vien|employee|người|nguoi)\s+(?:thứ\s*)?\d{1,2})",
    re.IGNORECASE,
)
_NON_ENTITY_FOLLOWUP = {
    "khong",
    "khong can",
    "co",
    "ok",
    "duoc",
    "duoc roi",
    "cam on",
    "thanks",
}
_COMPARISON_FOLLOWUP_RE = re.compile(
    r"\b(so\s+sánh|so\s+sanh|so\s+với|so\s+voi|còn|con|tiếp|tiep|vậy|vay|"
    r"thế\s+còn|the\s+con)\b",
    re.IGNORECASE,
)
_RANKING_FOLLOWUP_RE = re.compile(
    r"\b(cao\s+nhất|cao\s+nhat|nhiều\s+nhất|nhieu\s+nhat|top|rank|ranking|"
    r"xếp\s+hạng|xep\s+hang|cửa\s+hàng\s+nào|cua\s+hang\s+nao|outlet\s+nào|outlet\s+nao)\b",
    re.IGNORECASE,
)
_OUTLET_DIRECTORY_RE = re.compile(
    r"(có\s+(các|những)\s+(cửa\s*hàng|cua\s*hang|outlet|chi\s*nhánh|chi\s*nhanh)"
    r"|co\s+(cac|nhung)\s+(cua\s*hang|outlet|chi\s*nhanh)"
    r"|những\s+(cửa\s*hàng|cua\s*hang|outlet)\s+nào"
    r"|nhung\s+(cua\s*hang|outlet)\s+nao"
    r"|các\s+(cửa\s*hàng|cua\s*hang|outlet)\s+nào"
    r"|cac\s+(cua\s*hang|outlet)\s+nao"
    r"|danh\s*sách\s+(cửa|cua|outlet|chi\s+nhánh|chi\s+nhanh)"
    r"|danh\s*sach\s+(cua|outlet|chi\s+nhanh)"
    r"|liệt\s*kê\s+(outlet|cửa|cua)"
    r"|liet\s*ke\s+(outlet|cua)"
    r"|hệ\s*thống.*(cửa\s*hàng|cua\s*hang|outlet)"
    r"|he\s*thong.*(cua\s*hang|outlet)"
    r"|store\s+list|list\s+outlets?)",
    re.IGNORECASE,
)
_DOMAIN_KEYWORDS_RE = re.compile(
    r"(doanh\s*(thu|số)|revenue|sales|tồn\s*kho|ton\s*kho|inventory|"
    r"sản\s*phẩm|san\s*pham|product|outlet|cửa\s*hàng|cua\s*hang|"
    r"nhân\s*viên|nhan\s*vien|employee|staff|chấm\s*công|cham\s*cong|"
    r"đi\s*làm|di\s*lam|làm\s*việc|lam\s*viec|công\s*ty|cong\s*ty|"
    r"giờ\s*làm|gio\s*lam|tổng\s*giờ|tong\s*gio|bao\s*nhiêu\s*giờ|bao\s*nhieu\s*gio|"
    r"thâm\s*niên|tham\s*nien|lương|luong|payroll|salary|p&l|lãi\s*lỗ|lai\s*lo)",
    re.IGNORECASE,
)
_CONTEXT_TIME_EXPR_RE = re.compile(
    r"\b("
    r"hôm\s*nay|hom\s*nay|hôm\s*qua|hom\s*qua|today|yesterday|"
    r"tuần\s*này|tuan\s*nay|tuần\s*(?:trước|truoc|rồi|roi|vừa\s*rồi|vua\s*roi|qua)|this\s*week|last\s*week|"
    r"tháng\s*này|thang\s*nay|tháng\s*(?:trước|truoc|rồi|roi|vừa\s*rồi|vua\s*roi|qua)|this\s*month|last\s*month|"
    r"quý\s*này|quy\s*nay|quý\s*(?:trước|truoc|rồi|roi|vừa\s*rồi|vua\s*roi)|quy\s*(?:truoc|roi|vua\s*roi)|"
    r"this\s*quarter|last\s*quarter|quý\s*[1-4]|quy\s*[1-4]|q[1-4](?:\s*20\d{2})?|"
    r"tháng\s*(?:0?[1-9]|1[0-2])(?:\s*(?:/|năm|nam)\s*20\d{2})?|thang\s*(?:0?[1-9]|1[0-2])(?:\s*(?:/|nam)\s*20\d{2})?|"
    r"năm\s*nay|nam\s*nay|năm\s*(?:trước|ngoái|rồi|vừa\s*rồi)|nam\s*(?:truoc|ngoai|roi|vua\s*roi)|"
    r"this\s*year|last\s*year|năm\s*20\d{2}|nam\s*20\d{2}|20\d{2}|"
    r"\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*20\d{2})?|"
    r"\d{1,3}\s*ngày\s*(?:gần\s*nhất|qua|rồi|vừa\s*rồi|trước)|\d{1,3}\s*ngay\s*(?:gan\s*nhat|qua|roi|vua\s*roi|truoc)"
    r")\b",
    re.IGNORECASE,
)


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def previous_user_question(state: GraphState) -> str:
    current = (state.get("normalized_question") or state.get("raw_question") or "").strip()
    turns = state.get("conversation_turns") or []
    fallback = ""
    for turn in reversed(turns):
        if (turn.get("role") or "").strip().lower() != "user":
            continue
        content = (turn.get("content") or "").strip()
        if not content or content == current:
            continue
        if not fallback:
            fallback = content
        if _DOMAIN_KEYWORDS_RE.search(content) and not is_time_followup(content):
            return content
    return fallback


def effective_question(state: GraphState) -> str:
    """Return the standalone question if available, otherwise the normalized input."""
    return (
        (state.get("contextualized_question") or "").strip()
        or (state.get("normalized_question") or state.get("raw_question") or "").strip()
    )


def _should_contextualize(current: str, previous: str) -> tuple[bool, str]:
    if not current or not previous:
        return False, ""
    if _OUTLET_DIRECTORY_RE.search(current):
        return False, ""
    if not _DOMAIN_KEYWORDS_RE.search(previous):
        return False, ""
    if is_time_followup(current):
        return True, "rule_time_followup"

    folded = _fold(current)
    words = [w for w in re.split(r"\s+", folded.strip(" ?!.,")) if w]
    if (
        0 < len(words) <= 10
        and has_time_expression(previous)
        and not has_time_expression(current)
        and _RANKING_FOLLOWUP_RE.search(current)
        and _DOMAIN_KEYWORDS_RE.search(current)
    ):
        return True, "rule_inherit_time_for_ranking"
    if 0 < len(words) <= 5 and _SHORT_FILTER_RE.match(current):
        return True, "rule_short_filter_followup"
    if 0 < len(words) <= 6 and _COMPARISON_FOLLOWUP_RE.search(current):
        return True, "rule_short_followup"
    if (
        has_time_expression(previous)
        and not has_time_expression(current)
        and _HR_CONTEXT_RE.search(previous)
        and _HR_EMPLOYEE_SELECTION_RE.search(current)
    ):
        return True, "rule_hr_employee_selection_followup"
    if (
        1 <= len(words) <= 5
        and folded not in _NON_ENTITY_FOLLOWUP
        and _PAYROLL_PREVIOUS_RE.search(previous)
        and _NAME_ONLY_RE.match(current)
    ):
        return True, "rule_employee_followup"
    if (
        1 <= len(words) <= 5
        and folded not in _NON_ENTITY_FOLLOWUP
        and _PRODUCT_INVENTORY_CONTEXT_RE.search(previous)
        and _NAME_ONLY_RE.match(current)
    ):
        return True, "rule_product_entity_followup"
    return False, ""


def _strip_prior_time_context(text: str) -> str:
    stripped = _CONTEXT_TIME_EXPR_RE.sub(" ", text or "")
    stripped = re.sub(r"\s+", " ", stripped).strip(" ?!.;,")
    return stripped or (text or "").strip(" ?!.;,")


def _clean_short_filter_value(text: str) -> str:
    value = re.sub(r"^\s*(còn|con|vậy|vay|thế|the|ở|o)\s+", "", text or "", flags=re.IGNORECASE)
    return value.strip(" ?!.;,")


def _replace_prior_outlet_filter(previous: str, current: str) -> str | None:
    current_value = _clean_short_filter_value(current)
    if not re.search(r"\b(outlet|cửa\s*hàng|cua\s*hang|chi\s*nhánh|chi\s*nhanh)\b", current_value, re.IGNORECASE):
        return None
    base = re.sub(
        r"\s+(?:của|cua|ở|o|tại|tai|cho)?\s*"
        r"(?:outlet|cửa\s*hàng|cua\s*hang|chi\s*nhánh|chi\s*nhanh)\s+"
        r"(?:[A-Z]{2,}(?:-[A-Z0-9]+){1,}|\d{1,4}|[A-Za-zÀ-ỹ0-9 .-]{2,50})"
        r"\s*$",
        "",
        previous.rstrip(" ?.!,;:"),
        flags=re.IGNORECASE,
    )
    base = re.sub(r"\s+", " ", base).strip(" ?!.;,")
    if not base or base == previous.rstrip(" ?.!,;:"):
        return None
    return f"{base} của {current_value}".strip()


def contextualizer(state: GraphState) -> GraphState:
    current = (state.get("normalized_question") or state.get("raw_question") or "").strip()
    previous = previous_user_question(state)
    ok, source = _should_contextualize(current, previous)

    if ok:
        # Keep wording simple. Downstream LLMs see both original context and this effective question.
        replacement = _replace_prior_outlet_filter(previous, current) if source == "rule_short_filter_followup" else None
        if replacement:
            state["contextualized_question"] = replacement
        else:
            base = _strip_prior_time_context(previous) if source == "rule_time_followup" else previous.rstrip(" ?.!,;:")
            state["contextualized_question"] = f"{base} {current}".strip()
        state["contextualization_source"] = source
        state.setdefault("trace", []).append({"node": "contextualizer", "outcome": "rewritten", "reason": source})
    else:
        state.pop("contextualized_question", None)
        state.pop("contextualization_source", None)
        state.setdefault("trace", []).append({"node": "contextualizer", "skipped": True})

    return state
