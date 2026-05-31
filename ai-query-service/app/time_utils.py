from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
import re
import unicodedata
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import get_settings


def app_timezone() -> ZoneInfo:
    name = (get_settings().app_timezone or "Asia/Ho_Chi_Minh").strip()
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("Asia/Ho_Chi_Minh")


def today_local() -> date:
    return datetime.now(app_timezone()).date()


def fold_text(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


_ISO_DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
_NUMERIC_DATE_RE = re.compile(
    r"(?<![\d/-])"
    r"(?P<day>0?[1-9]|[12]\d|3[01])\s*[/-]\s*"
    r"(?P<month>0?[1-9]|1[0-2])"
    r"(?:\s*[/-]\s*(?P<year>20\d{2}))?"
    r"(?![\d/-])"
)
_NUMERIC_DATE_FOLLOWUP_RE = re.compile(
    r"^\s*(?:(?:con|vay|the|thi|tie?p)\s+)*(?:so\s+voi|so\s+sanh(?:\s+voi)?|compare\s+to)?\s*"
    r"(?:tu\s+ngay\s+|tu\s+|ngay\s+)?"
    r"(?:\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*20\d{2})?)"
    r"(?:\s*(?:den|toi|-)\s*(?:ngay\s+)?\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*20\d{2})?)?"
    r"(?:\s*(?:thi\s*sao|ra\s*sao|nua|vay|nhi|nhe|khong|ko))?\s*[?!.]*\s*$",
    re.IGNORECASE,
)
_TIME_EXPR_RE = re.compile(
    r"\b("
    r"hom\s*nay|today|hom\s*qua|yesterday|"
    r"trong\s*tuan(?:\s*nay)?|tuan\s*nay|this\s*week|tuan\s*(?:truoc|roi|vua\s*roi|qua)|last\s*week|"
    r"thang\s*nay|this\s*month|thang\s*(?:truoc|roi|vua\s*roi|qua)|last\s*month|"
    r"quy\s*nay|this\s*quarter|quy\s*(?:truoc|roi|vua\s*roi)|last\s*quarter|"
    r"quy\s*[1-4](?:\s*(?:/|nam)?\s*(?:20\d{2}|nay|truoc|ngoai|roi))?|q[1-4](?:\s*20\d{2})?|"
    r"thang\s*(?:0?[1-9]|1[0-2])(?:\s*(?:[,.;/&-]|va|den|toi)\s*(?:thang\s*)?(?:0?[1-9]|1[0-2]))?(?:\s*(?:/|nam)?\s*(?:20\d{2}|nay|truoc|ngoai|roi))?|"
    r"\d{1,2}\s*nam\s*(?:nay|gan\s*nhat|gan\s*day|qua|roi|vua\s*roi|truoc)|"
    r"nam\s*nay|this\s*year|nam\s*(?:truoc|roi|ngoai|vua\s*roi)|last\s*year|"
    r"nam\s*20\d{2}|20\d{2}|"
    r"cung\s*ky(?:\s*(?:nam\s*(?:truoc|ngoai)|last\s*year))?|same\s*period(?:\s*last\s*year)?|"
    r"\d{1,3}\s*ngay\s*(?:gan\s*nhat|qua|roi|vua\s*roi|truoc)|"
    r"ky\s*truoc|ki\s*truoc|period\s*truoc|previous\s*period"
    r")\b",
    re.IGNORECASE,
)
_TIME_FOLLOWUP_RE = re.compile(
    r"^\s*(?:(?:con|vay|the|thi|tie?p)\s+)*(?:so\s+voi|so\s+sanh(?:\s+voi)?|compare\s+to)?\s*"
    r"(?P<expr>"
    r"hom\s*nay|today|hom\s*qua|yesterday|"
    r"trong\s*tuan(?:\s*nay)?|tuan\s*nay|this\s*week|tuan\s*(?:truoc|roi|vua\s*roi|qua)|last\s*week|"
    r"thang\s*nay|this\s*month|thang\s*(?:truoc|roi|vua\s*roi|qua)|last\s*month|"
    r"quy\s*nay|this\s*quarter|quy\s*(?:truoc|roi|vua\s*roi)|last\s*quarter|"
    r"quy\s*[1-4](?:\s*(?:/|nam)?\s*(?:20\d{2}|nay|truoc|ngoai|roi))?|q[1-4](?:\s*20\d{2})?|"
    r"thang\s*(?:0?[1-9]|1[0-2])(?:\s*(?:[,.;/&-]|va|den|toi)\s*(?:thang\s*)?(?:0?[1-9]|1[0-2]))?(?:\s*(?:/|nam)?\s*(?:20\d{2}|nay|truoc|ngoai|roi))?|"
    r"\d{1,2}\s*nam\s*(?:nay|gan\s*nhat|gan\s*day|qua|roi|vua\s*roi|truoc)|"
    r"nam\s*nay|this\s*year|nam\s*(?:truoc|roi|ngoai|vua\s*roi)|last\s*year|"
    r"nam\s*20\d{2}|20\d{2}|"
    r"cung\s*ky(?:\s*(?:nam\s*(?:truoc|ngoai)|last\s*year))?|same\s*period(?:\s*last\s*year)?|"
    r"\d{1,3}\s*ngay\s*(?:gan\s*nhat|qua|roi|vua\s*roi|truoc)|"
    r"ky\s*truoc|ki\s*truoc|period\s*truoc|previous\s*period"
    r")"
    r"(?:\s*(?:thi\s*sao|ra\s*sao|nua|vay|nhi|nhe|khong|ko))?\s*[?!.]*\s*$",
    re.IGNORECASE,
)
_SAME_PERIOD_COMPARISON_RE = re.compile(
    r"\b(?:so\s+sanh(?:\s+voi)?|so\s+voi|compare(?:\s+to)?)\b.*\b(cung\s*ky|same\s*period)\b"
    r"|\b(cung\s*ky|same\s*period)\b.*\b(?:so\s+sanh(?:\s+voi)?|so\s+voi|compare(?:\s+to)?)\b",
    re.IGNORECASE,
)
_SAME_PERIOD_PHRASE_RE = re.compile(
    r"\b(?:cung\s*ky(?:\s*(?:nam\s*(?:truoc|ngoai)|last\s*year))?|same\s*period(?:\s*last\s*year)?)\b",
    re.IGNORECASE,
)


def has_time_expression(text: str) -> bool:
    raw = text or ""
    return bool(_ISO_DATE_RE.search(raw) or _NUMERIC_DATE_RE.search(raw) or _TIME_EXPR_RE.search(fold_text(raw)))


def is_time_followup(text: str) -> bool:
    folded = fold_text(text).strip(" \t\r\n'\"`’‘“”.,!?;:")
    return bool(_TIME_FOLLOWUP_RE.match(folded) or _NUMERIC_DATE_FOLLOWUP_RE.match(folded))


def _iso(d: date) -> str:
    return d.isoformat()


def _month_range(year: int, month: int) -> dict[str, str]:
    last_day = calendar.monthrange(year, month)[1]
    return {"from_date": date(year, month, 1).isoformat(), "to_date": date(year, month, last_day).isoformat()}


def _month_span_range(year: int, start_month: int, end_month: int) -> dict[str, str]:
    if start_month <= end_month:
        last_day = calendar.monthrange(year, end_month)[1]
        return {
            "from_date": date(year, start_month, 1).isoformat(),
            "to_date": date(year, end_month, last_day).isoformat(),
        }
    # Cross-year month spans are rare but explicit enough to support:
    # "tháng 12 đến tháng 1 năm nay" = Dec previous year through Jan current year.
    last_day = calendar.monthrange(year, end_month)[1]
    return {
        "from_date": date(year - 1, start_month, 1).isoformat(),
        "to_date": date(year, end_month, last_day).isoformat(),
    }


def _quarter_range(year: int, quarter: int) -> dict[str, str]:
    start_month = (quarter - 1) * 3 + 1
    end_month = start_month + 2
    last_day = calendar.monthrange(year, end_month)[1]
    return {
        "from_date": date(year, start_month, 1).isoformat(),
        "to_date": date(year, end_month, last_day).isoformat(),
    }


_QUARTER_REF_RE = re.compile(
    r"\b(?:q|quy)\s*([1-4])\s*/\s*(20\d{2})\b|\bquy\s*([1-4])\s+nam\s+(20\d{2})\b",
    re.IGNORECASE,
)


def parse_two_quarter_ranges_in_order(text: str) -> tuple[dict[str, str], dict[str, str]] | None:
    """Extract the first two calendar quarter references in left-to-right order.

    Example: "Quý 1/2026 cao hơn Quý 3/2025" → (Q1 2026 range, Q3 2025 range).
    Returns ``(period_a, period_b)`` as ``{"from_date","to_date"}`` dicts or None.
    """
    folded = fold_text(text or "")
    spans: list[tuple[int, int, int]] = []
    for m in _QUARTER_REF_RE.finditer(folded):
        if m.group(1):
            qn, yr = int(m.group(1)), int(m.group(2))
        else:
            qn, yr = int(m.group(3)), int(m.group(4))
        spans.append((m.start(), qn, yr))
    if len(spans) < 2:
        return None
    spans.sort(key=lambda t: t[0])
    _, q1, y1 = spans[0]
    _, q2, y2 = spans[1]
    return _quarter_range(y1, q1), _quarter_range(y2, q2)


def _current_quarter(today: date) -> int:
    return ((today.month - 1) // 3) + 1


def _previous_quarter(today: date) -> tuple[int, int]:
    q = _current_quarter(today)
    if q == 1:
        return today.year - 1, 4
    return today.year, q - 1


def _year_from_relative_token(token: str | None, base: date) -> int:
    value = (token or "").strip().lower()
    if re.fullmatch(r"20\d{2}", value):
        return int(value)
    if value in {"truoc", "ngoai", "roi"}:
        return base.year - 1
    return base.year


def _previous_period_from_context(context_text: str, today: date) -> dict[str, str] | None:
    ctx = fold_text(context_text)
    if re.search(r"\b(trong\s*tuan(?:\s*nay)?|tuan\s*nay|tuan\s*truoc|this\s*week|last\s*week)\b", ctx):
        this_monday = today - timedelta(days=today.weekday())
        return {"from_date": _iso(this_monday - timedelta(days=7)), "to_date": _iso(this_monday - timedelta(days=1))}
    if re.search(r"\b(quy\s*nay|quy\s*truoc|this\s*quarter|last\s*quarter|quy\s*[1-4]|q[1-4])\b", ctx):
        year, quarter = _previous_quarter(today)
        return _quarter_range(year, quarter)
    if re.search(r"\b(nam\s*nay|nam\s*truoc|nam\s*ngoai|this\s*year|last\s*year|nam\s*20\d{2})\b", ctx):
        prev_year = today.year - 1
        return {"from_date": date(prev_year, 1, 1).isoformat(), "to_date": date(prev_year, 12, 31).isoformat()}
    if re.search(r"\b(hom\s*nay|today|hom\s*qua|yesterday)\b", ctx):
        d = today - timedelta(days=1)
        return {"from_date": _iso(d), "to_date": _iso(d)}
    if re.search(r"\b(thang\s*nay|thang\s*truoc|this\s*month|last\s*month|thang\s*(?:0?[1-9]|1[0-2]))\b", ctx):
        first_this_month = today.replace(day=1)
        last_prev_month = first_this_month - timedelta(days=1)
        return _month_range(last_prev_month.year, last_prev_month.month)
    return None


def _coerce_numeric_date(day: str, month: str, year: str | None, default_year: int) -> date | None:
    try:
        return date(int(year or default_year), int(month), int(day))
    except ValueError:
        return None


def _numeric_dates(text: str, base: date) -> list[date]:
    matches = list(_NUMERIC_DATE_RE.finditer(text or ""))
    if not matches:
        return []

    explicit_year = next((m.group("year") for m in matches if m.group("year")), None)
    default_year = int(explicit_year or base.year)
    dates: list[date] = []
    for match in matches:
        prefix = fold_text((text or "")[: match.start()])
        if re.search(r"\b(thang|quy|q)\s*$", prefix):
            continue
        parsed = _coerce_numeric_date(
            match.group("day"),
            match.group("month"),
            match.group("year"),
            default_year,
        )
        if parsed:
            dates.append(parsed)
    return dates


def _shift_year(d: date, years: int = -1) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, day=28)


def _same_period_last_year_from_context(context_text: str, today: date) -> dict[str, str]:
    for raw_line in reversed((context_text or "").splitlines()):
        line = raw_line.strip()
        if not line:
            continue
        folded_line = fold_text(line)
        if re.search(r"\b(cung\s*ky|same\s*period)\b", folded_line):
            continue
        if not has_time_expression(line):
            continue
        rng = parse_time_range(line, today=today, context_text="")
        start = _shift_year(date.fromisoformat(rng["from_date"]), -1)
        end = _shift_year(date.fromisoformat(rng["to_date"]), -1)
        return {"from_date": _iso(start), "to_date": _iso(end)}

    start = date(today.year - 1, 1, 1)
    end = _shift_year(today, -1)
    return {"from_date": _iso(start), "to_date": _iso(end)}


def _has_non_same_period_time_expression(text: str) -> bool:
    folded = fold_text(text)
    without_same_period = _SAME_PERIOD_PHRASE_RE.sub(" ", folded)
    return has_time_expression(without_same_period)


def _recent_anchor_period_from_context(context_text: str, today: date) -> dict[str, str] | None:
    for raw_line in reversed((context_text or "").splitlines()):
        line = raw_line.strip()
        if not line:
            continue
        folded_line = fold_text(line)
        if _SAME_PERIOD_PHRASE_RE.search(folded_line):
            continue
        if not has_time_expression(line):
            continue
        return parse_time_range(line, today=today, context_text="")
    return None


def parse_time_range(text: str, *, today: date | None = None, context_text: str | None = None) -> dict[str, str]:
    """Parse common Vietnamese/English report time phrases into an inclusive date range."""
    base = today or today_local()
    original = text or ""
    folded = fold_text(original)

    dates = _ISO_DATE_RE.findall(original)
    if len(dates) >= 2:
        return {"from_date": dates[0], "to_date": dates[1]}
    if len(dates) == 1:
        return {"from_date": dates[0], "to_date": dates[0]}

    numeric_dates = _numeric_dates(original, base)
    if len(numeric_dates) >= 2:
        return {"from_date": _iso(numeric_dates[0]), "to_date": _iso(numeric_dates[1])}
    if len(numeric_dates) == 1:
        return {"from_date": _iso(numeric_dates[0]), "to_date": _iso(numeric_dates[0])}

    rolling = re.search(r"\b(\d{1,3})\s*ngay\s*(gan\s*nhat|qua|roi|vua\s*roi|truoc)\b", folded)
    if rolling:
        days = max(1, min(int(rolling.group(1)), 366))
        if "truoc" in rolling.group(2):
            end = base - timedelta(days=1)
            start = end - timedelta(days=days - 1)
        else:
            end = base
            start = base - timedelta(days=days - 1)
        return {"from_date": _iso(start), "to_date": _iso(end)}

    month_span_match = re.search(
        r"\bthang\s*(0?[1-9]|1[0-2])\s*(?:[,.;/&-]|va|den|toi)\s*(?:thang\s*)?(0?[1-9]|1[0-2])"
        r"(?:\s*(?:/|nam)?\s*(20\d{2}|nay|truoc|ngoai|roi))?\b",
        folded,
    )
    if month_span_match:
        start_month = int(month_span_match.group(1))
        end_month = int(month_span_match.group(2))
        year = _year_from_relative_token(month_span_match.group(3), base)
        return _month_span_range(year, start_month, end_month)

    month_match = re.search(
        r"\bthang\s*(0?[1-9]|1[0-2])(?:\s*(?:/|nam)?\s*(20\d{2}|nay|truoc|ngoai|roi))?\b",
        folded,
    )
    if month_match:
        month = int(month_match.group(1))
        year = _year_from_relative_token(month_match.group(2), base)
        return _month_range(year, month)

    quarter_match = re.search(r"\b(?:quy\s*|q)([1-4])(?:\s*(?:/|nam)?\s*(20\d{2}|nay|truoc|ngoai|roi))?\b", folded)
    if quarter_match:
        quarter = int(quarter_match.group(1))
        year = _year_from_relative_token(quarter_match.group(2), base)
        return _quarter_range(year, quarter)

    years_window = re.search(
        r"\b(\d{1,2})\s*nam\s*(nay|gan\s*nhat|gan\s*day|qua|roi|vua\s*roi|truoc)\b", folded
    )
    if years_window:
        years = max(1, min(int(years_window.group(1)), 10))
        qualifier = years_window.group(2)
        if qualifier == "truoc":
            target_year = base.year - years
            return {"from_date": date(target_year, 1, 1).isoformat(), "to_date": date(target_year, 12, 31).isoformat()}
        if qualifier == "nay":
            start_year = base.year - years + 1
            return {"from_date": date(start_year, 1, 1).isoformat(), "to_date": _iso(base)}
        start = _shift_year(base, -years) + timedelta(days=1)
        return {"from_date": _iso(start), "to_date": _iso(base)}

    if re.search(r"\b(hom\s*qua|yesterday)\b", folded):
        d = base - timedelta(days=1)
        return {"from_date": _iso(d), "to_date": _iso(d)}
    if re.search(r"\b(hom\s*nay|today)\b", folded):
        return {"from_date": _iso(base), "to_date": _iso(base)}

    if re.search(r"\b(tuan\s*(truoc|roi|vua\s*roi|qua)|last\s*week)\b", folded):
        this_monday = base - timedelta(days=base.weekday())
        return {"from_date": _iso(this_monday - timedelta(days=7)), "to_date": _iso(this_monday - timedelta(days=1))}
    if re.search(r"\b(trong\s*tuan(?:\s*nay)?|tuan\s*nay|this\s*week)\b", folded):
        start = base - timedelta(days=base.weekday())
        return {"from_date": _iso(start), "to_date": _iso(base)}

    if re.search(r"\b(thang\s*(truoc|roi|vua\s*roi|qua)|last\s*month)\b", folded):
        first_this_month = base.replace(day=1)
        last_prev_month = first_this_month - timedelta(days=1)
        return _month_range(last_prev_month.year, last_prev_month.month)
    if re.search(r"\b(thang\s*nay|this\s*month)\b", folded):
        return {"from_date": _iso(base.replace(day=1)), "to_date": _iso(base)}

    if re.search(r"\b(quy\s*(truoc|roi|vua\s*roi)|last\s*quarter)\b", folded):
        year, quarter = _previous_quarter(base)
        return _quarter_range(year, quarter)
    if re.search(r"\b(quy\s*nay|this\s*quarter)\b", folded):
        q = _current_quarter(base)
        start_month = (q - 1) * 3 + 1
        return {"from_date": date(base.year, start_month, 1).isoformat(), "to_date": base.isoformat()}

    if re.search(r"\b(cung\s*ky(?:\s*(?:nam\s*(?:truoc|ngoai)|last\s*year))?|same\s*period(?:\s*last\s*year)?)\b", folded):
        return _same_period_last_year_from_context(context_text or "", base)

    if re.search(r"\b(nam\s*(truoc|roi|ngoai|vua\s*roi)|last\s*year)\b", folded):
        prev_year = base.year - 1
        return {"from_date": date(prev_year, 1, 1).isoformat(), "to_date": date(prev_year, 12, 31).isoformat()}
    if re.search(r"\b(nam\s*nay|this\s*year)\b", folded):
        return {"from_date": _iso(base.replace(month=1, day=1)), "to_date": _iso(base)}

    year_match = re.search(r"\b(?:nam\s*)?(20\d{2})\b", folded)
    if year_match:
        year = int(year_match.group(1))
        return {"from_date": date(year, 1, 1).isoformat(), "to_date": date(year, 12, 31).isoformat()}

    if re.search(r"\b(ky\s*truoc|ki\s*truoc|period\s*truoc|previous\s*period)\b", folded):
        inferred = _previous_period_from_context(context_text or "", base)
        if inferred:
            return inferred

    return {"from_date": _iso(base), "to_date": _iso(base)}


def build_time_context(
    *,
    current_question: str,
    effective_question: str,
    conversation_context: str = "",
    today: date | None = None,
) -> dict[str, str | bool]:
    """Authoritative time facts passed to LLM prompts and workflow debug."""
    base = today or today_local()
    current_has_time = has_time_expression(current_question)
    time_source_text = current_question if current_has_time else effective_question
    context_text = f"{effective_question}\n{conversation_context}".strip()
    rng = parse_time_range(time_source_text, today=base, context_text=context_text)
    source = "current_turn" if current_has_time else "effective_question"
    if is_time_followup(current_question):
        source = "followup_current_turn"

    comparison_range: dict[str, str] | None = None
    if _SAME_PERIOD_COMPARISON_RE.search(fold_text(current_question)):
        if not _has_non_same_period_time_expression(current_question):
            anchor = _recent_anchor_period_from_context(context_text, base)
            if anchor:
                rng = anchor
                source = "comparison_base_from_context"
        start = _shift_year(date.fromisoformat(rng["from_date"]), -1)
        end = _shift_year(date.fromisoformat(rng["to_date"]), -1)
        comparison_range = {"from_date": _iso(start), "to_date": _iso(end), "label": "cùng kỳ năm ngoái"}

    fd = str(rng["from_date"])
    td = str(rng["to_date"])
    period = fd if fd == td else f"{fd} đến {td}"
    out: dict[str, str | bool] = {
        "today": base.isoformat(),
        "from_date": fd,
        "to_date": td,
        "source": source,
        "current_has_time_expression": current_has_time,
        "is_time_followup": is_time_followup(current_question),
        "time_source_text": time_source_text[:500],
        "inference_vi": f"Đang hiểu khoảng thời gian là {period}, suy ra từ {source}.",
    }
    if comparison_range:
        out["comparison_from_date"] = comparison_range["from_date"]
        out["comparison_to_date"] = comparison_range["to_date"]
        out["comparison_label"] = comparison_range["label"]
        out["inference_vi"] += (
            f" So sánh với {comparison_range['label']}: "
            f"{comparison_range['from_date']} đến {comparison_range['to_date']}."
        )
    return out


def format_time_context_for_prompt(ctx: dict | None) -> str:
    if not isinstance(ctx, dict) or not ctx:
        return ""
    return (
        "\nTime intelligence (authoritative; use this instead of guessing dates):\n"
        f"- Today/app date: {ctx.get('today')}\n"
        f"- Resolved time_range: {ctx.get('from_date')} → {ctx.get('to_date')}\n"
        f"- Source: {ctx.get('source')}; follow_up={ctx.get('is_time_followup')}; "
        f"current_has_time={ctx.get('current_has_time_expression')}\n"
        f"- Time source text: {ctx.get('time_source_text')}\n"
        f"- VI: {ctx.get('inference_vi')}\n"
    )
