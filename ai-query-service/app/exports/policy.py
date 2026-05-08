"""Deterministic policy: when to auto-generate a CSV export."""

from __future__ import annotations

import re
from typing import Any

_EXPLICIT_EXPORT_RE = re.compile(
    r"\b(export|xuất|xuat|tải|tai|download|excel|csv|file|đính kèm|dinh kem|"
    r"chi tiết|chi tiet|raw|đối chiếu|doi chieu|kiểm chứng|kiem chung|kiểm tra|kiem tra)\b",
    re.IGNORECASE,
)

_AUTO_EXPORT_ROW_THRESHOLD = 20


def should_generate_export(
    *,
    intent: str | None,
    response_kind: str | None,
    row_count: int,
    question: str,
    template_key: str | None,
) -> tuple[bool, str]:
    """Return (should_generate, reason).

    Decision precedence:
      1. clarification / social / no rows → never.
      2. intent == "export_request" → always.
      3. Question has explicit export keyword → yes.
      4. row_count >= threshold → yes (executive verification).
      5. Sensitive financial template (P&L, payroll) → yes.
      6. Otherwise → no.
    """
    if response_kind in {"clarification", "unsupported"}:
        return False, "non_data_response"
    if row_count <= 0:
        return False, "empty_result"
    if intent == "export_request":
        return True, "intent_export_request"
    if question and _EXPLICIT_EXPORT_RE.search(question):
        return True, "explicit_keyword"
    if row_count >= _AUTO_EXPORT_ROW_THRESHOLD:
        return True, f"row_count>={_AUTO_EXPORT_ROW_THRESHOLD}"
    sensitive_templates = {
        "T24_daily_pnl_summary",
        "T25_payroll_cost_by_outlet",
        "T26_cogs_summary",
    }
    if template_key in sensitive_templates:
        return True, "sensitive_financial_template"
    return False, "below_threshold"


def safe_filename_stem(question: str, intent: str | None) -> str:
    base = (intent or "query").replace("_", "-")
    snippet = re.sub(r"[^a-zA-Z0-9]+", "-", (question or "").strip().lower())[:30].strip("-")
    return f"{base}-{snippet}" if snippet else base


__all__ = ["should_generate_export", "safe_filename_stem"]
