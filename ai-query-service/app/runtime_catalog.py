from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

from app.clients.postgres import execute_readonly
from app.config import get_settings

logger = logging.getLogger(__name__)

_LOCK = threading.RLock()
_CACHE: dict[str, Any] = {
    "loaded_at": 0.0,
    "catalog_version": None,
    "payload": None,
    "error": None,
}


def _cache_ttl_seconds() -> int:
    return max(5, int(getattr(get_settings(), "runtime_catalog_cache_seconds", 60) or 60))


def _table_select_sql() -> str:
    return """
    SELECT catalog_version, payload_json
    FROM ai.ai_query_runtime_catalog
    WHERE catalog_key = %(catalog_key)s
      AND is_active = TRUE
    ORDER BY catalog_version DESC, updated_at DESC
    LIMIT 1
    """


def clear_runtime_catalog_cache() -> None:
    with _LOCK:
        _CACHE.update({"loaded_at": 0.0, "catalog_version": None, "payload": None, "error": None})


def _decode_payload(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def load_runtime_catalog(*, force: bool = False) -> tuple[int | None, dict[str, Any] | None]:
    now = time.time()
    with _LOCK:
        fresh = (now - float(_CACHE["loaded_at"] or 0.0)) < _cache_ttl_seconds()
        if not force and fresh:
            return _CACHE["catalog_version"], _CACHE["payload"]

    version: int | None = None
    payload: dict[str, Any] | None = None
    error: str | None = None

    try:
        rows = execute_readonly(_table_select_sql(), {"catalog_key": "default"})
        if rows:
            row = rows[0]
            raw_version = row.get("catalog_version")
            version = int(raw_version) if raw_version is not None else None
            payload = _decode_payload(row.get("payload_json"))
    except Exception as exc:  # noqa: BLE001
        error = type(exc).__name__
        logger.debug("runtime catalog unavailable; using in-repo defaults: %s", exc)

    with _LOCK:
        _CACHE.update(
            {
                "loaded_at": now,
                "catalog_version": version,
                "payload": payload,
                "error": error,
            }
        )
        return version, payload


def get_runtime_catalog_section(name: str, *, force: bool = False) -> tuple[int | None, dict[str, Any] | None]:
    version, payload = load_runtime_catalog(force=force)
    if not isinstance(payload, dict):
        return version, None
    section = payload.get(name)
    return version, section if isinstance(section, dict) else None

