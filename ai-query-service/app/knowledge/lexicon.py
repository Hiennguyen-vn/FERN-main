"""Semantic hints for template matching (YAML in knowledge/)."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_LEXICON_PATH = _PROJECT_ROOT / "knowledge" / "analytics_lexicon.yaml"

_map: dict[str, str] | None = None


def load_lexicon_map() -> dict[str, str]:
    global _map
    if _map is not None:
        return _map
    raw: dict[str, Any] = {}
    try:
        if _LEXICON_PATH.is_file():
            with open(_LEXICON_PATH, encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        if not isinstance(raw, dict):
            raw = {}
    except Exception as e:  # noqa: BLE001
        logger.warning("analytics_lexicon load failed: %s", e)
        raw = {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        if isinstance(k, str) and isinstance(v, str) and v.strip():
            out[k.strip()] = v.strip()
    _map = out
    return out


def format_lexicon_hints(template_keys: list[str], *, max_keys: int = 16, max_chars: int = 3500) -> str:
    """Compact bullet block for matcher system prompt."""
    mp = load_lexicon_map()
    lines: list[str] = []
    total = 0
    for key in template_keys[:max_keys]:
        line = f"- **{key}**: {mp.get(key, '(mô tả template trong registry)')}"
        if total + len(line) > max_chars:
            lines.append("- …")
            break
        lines.append(line)
        total += len(line) + 1
    return "\n".join(lines) if lines else ""
