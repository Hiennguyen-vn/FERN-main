"""Shared text utilities for FERN ai-query-service.

Centralises Vietnamese-aware text normalisation so individual modules do not
each maintain their own copy of ``_fold_text``.
"""
from __future__ import annotations

import unicodedata


def fold_text(text: str) -> str:
    """Normalise Vietnamese text for keyword matching.

    Steps:
    1. Replace the non-combining ``đ``/``Đ`` characters (not decomposed by NFD).
    2. NFD-decompose so diacritics become separate combining marks.
    3. Strip all combining marks (Unicode category "Mn").
    4. Lowercase and collapse whitespace.

    The result is pure ASCII Latin, suitable for simple ``in`` / regex checks
    without needing locale-aware collation.

    Examples::

        fold_text("Doanh thu")       → "doanh thu"
        fold_text("phân tích")       → "phan tich"
        fold_text("đại lý")          → "dai ly"
        fold_text("  Tháng  Này  ")  → "thang nay"
    """
    if not text:
        return ""
    text = text.replace("đ", "d").replace("Đ", "D")
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return " ".join(stripped.lower().split())
