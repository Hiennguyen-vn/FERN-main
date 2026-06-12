"""PII redaction for audit/learning pipelines.

Regex-based today; swap ``RegexPIIRedactor`` for a classifier-backed
implementation without changing call sites.
"""

from __future__ import annotations

import re
from typing import Protocol


class PIIRedactor(Protocol):
    def redact(self, text: str) -> str: ...


# Conservative patterns — phone (VN), email, national ID (CCCD).
_PHONE = re.compile(r"(?<!\d)(0[3-9]\d{8}|\+84[3-9]\d{8})(?!\d)")
_EMAIL = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_CCCD = re.compile(r"(?<!\d)\d{12}(?!\d)")
# Loose Vietnamese address cues (số nhà + đường/phường/quận).
_ADDRESS = re.compile(
    r"\b(?:số|so)\s*\d{1,5}[^\n,]{0,80}?(?:đường|duong|phường|phuong|quận|quan|thành phố|thanh pho)\b",
    re.IGNORECASE,
)


class RegexPIIRedactor:
    """Best-effort regex redactor — default production implementation."""

    def redact(self, text: str) -> str:
        if not text:
            return text
        text = _PHONE.sub("[PHONE]", text)
        text = _EMAIL.sub("[EMAIL]", text)
        text = _CCCD.sub("[CCCD]", text)
        text = _ADDRESS.sub("[ADDRESS]", text)
        return text


_default_redactor: PIIRedactor = RegexPIIRedactor()


def get_pii_redactor() -> PIIRedactor:
    return _default_redactor


def set_pii_redactor(redactor: PIIRedactor) -> None:
    """Test hook / future classifier injection."""
    global _default_redactor
    _default_redactor = redactor


def redact_pii(text: str) -> str:
    return _default_redactor.redact(text)
