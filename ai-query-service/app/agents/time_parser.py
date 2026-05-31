from __future__ import annotations

import re
from datetime import date

from app.time_utils import today_local


def default_time_range() -> dict[str, str]:
    today = today_local().isoformat()
    return {"from_date": today, "to_date": today}


def invalid_time_reason(question: str) -> str | None:
    raw = question or ""
    q = raw.lower()
    if re.search(r"\bthang\s*(?:1[3-9]|[2-9]\d)\b", q):
        return "invalid_month"

    iso_dates: list[date] = []
    for iso_text in re.findall(r"\b(20\d{2}-\d{2}-\d{2})\b", raw):
        try:
            iso_dates.append(date.fromisoformat(iso_text))
        except ValueError:
            return "invalid_iso_date"

    raw_without_iso_dates = re.sub(r"\b20\d{2}-\d{2}-\d{2}\b", " ", raw)
    for match in re.finditer(
        r"(?<![\d/-])(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(20\d{2}))?(?![\d/-])",
        raw_without_iso_dates,
    ):
        day = int(match.group(1))
        month = int(match.group(2))
        year = int(match.group(3) or today_local().year)
        try:
            date(year, month, day)
        except ValueError:
            return "invalid_numeric_date"

    if len(iso_dates) >= 2:
        if iso_dates[0] > iso_dates[1]:
            return "inverted_range"
        if (iso_dates[1] - iso_dates[0]).days > 2557:
            return "range_too_long"

    year_range = re.search(r"\b(20\d{2})\b\s*(?:den|toi|to|-)\s*\b(20\d{2})\b", q)
    if year_range:
        start_year = int(year_range.group(1))
        end_year = int(year_range.group(2))
        if start_year > end_year:
            return "inverted_year_range"
        if end_year - start_year > 7:
            return "range_too_long"

    years = [int(y) for y in re.findall(r"\b(?:nam\s*)?(19\d{2}|20\d{2})\b", q)]
    if any(y < 2020 for y in years):
        return "year_too_old"
    return None
