import re
import time
from typing import Any

import clickhouse_connect

from app.config import get_settings


_client = None


def get_ch_client():
    global _client
    if _client is None:
        s = get_settings()
        _client = clickhouse_connect.get_client(
            host=s.clickhouse_host,
            port=s.clickhouse_port,
            database=s.clickhouse_db,
            username=s.clickhouse_user,
            password=s.clickhouse_password,
            settings={
                "max_execution_time": s.query_timeout_seconds,
                "max_memory_usage": 2_000_000_000,
                "max_result_rows": s.max_rows_per_query,
                "readonly": 1,
            },
        )
    return _client


def execute_query(sql: str) -> list[dict[str, Any]]:
    client = get_ch_client()
    result = client.query(sql)
    columns = result.column_names
    return [dict(zip(columns, row)) for row in result.result_rows]


def explain_syntax(sql: str) -> tuple[bool, str]:
    """Lightweight ClickHouse compile check (read-only)."""
    try:
        client = get_ch_client()
        client.query(f"EXPLAIN SYNTAX {sql}", settings={"readonly": 1})
        return True, ""
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def explain_pipeline(sql: str, *, max_execution_seconds: float = 3.0) -> tuple[bool, str]:
    """Validate query plan compilation (read-only); complements EXPLAIN SYNTAX."""
    try:
        client = get_ch_client()
        client.query(
            f"EXPLAIN PIPELINE {sql}",
            settings={"readonly": 1, "max_execution_time": max_execution_seconds},
        )
        return True, ""
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def execute_query_with_settings(sql: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    """Single-shot query with merged settings (caller supplies caps for trials)."""
    client = get_ch_client()
    merged: dict[str, Any] = {"readonly": 1, **settings}
    result = client.query(sql, settings=merged)
    columns = result.column_names
    return [dict(zip(columns, row)) for row in result.result_rows]


_outlet_ids_cache: list[int] = []
_outlet_ids_cache_ts: float = 0.0
_OUTLET_IDS_TTL_SECONDS: float = 300.0  # 5 minutes


def fetch_all_outlet_ids() -> list[int]:
    """Used by RBAC injector for CFO/ADMIN global scope.

    Result is cached for 5 minutes so multiple graph-node instantiations
    within the same request window don't each pay a ClickHouse round-trip.
    Call ``fetch_all_outlet_ids.cache_clear()`` in tests to reset.
    """
    global _outlet_ids_cache, _outlet_ids_cache_ts
    now = time.monotonic()
    if _outlet_ids_cache and (now - _outlet_ids_cache_ts) < _OUTLET_IDS_TTL_SECONDS:
        return list(_outlet_ids_cache)
    rows = execute_query("SELECT id AS outlet_id FROM cdc.outlet FINAL ORDER BY id")
    _outlet_ids_cache = [int(r["outlet_id"]) for r in rows]
    _outlet_ids_cache_ts = now
    return list(_outlet_ids_cache)


def fetch_all_outlet_ids_cache_clear() -> None:
    """Invalidate the outlet-IDs cache; useful in tests and after bulk outlet changes."""
    global _outlet_ids_cache, _outlet_ids_cache_ts
    _outlet_ids_cache = []
    _outlet_ids_cache_ts = 0.0


def _execute_parameterized(sql: str, params: dict) -> list[dict[str, Any]]:
    """Execute a SELECT with clickhouse_connect native parameter binding.

    Parameters use the {name:Type} placeholder syntax supported by
    clickhouse_connect ≥ 0.7.  Values are bound server-side, which
    prevents SQL-injection regardless of the parameter content.
    """
    client = get_ch_client()
    result = client.query(sql, parameters=params)
    columns = result.column_names
    return [dict(zip(columns, row)) for row in result.result_rows]


def fetch_outlet_id_by_name_like(term: str, limit: int = 5) -> list[dict[str, Any]]:
    """Fallback for entity_resolver when OpenSearch score is low."""
    if not term or not term.strip():
        return []

    clean = term.strip()

    # Extract a bare numeric suffix from "outlet 42" style queries.
    numeric_suffix = ""
    m = re.search(r"\boutlet\s+(\d{1,6})\b", clean, flags=re.IGNORECASE)
    if m:
        numeric_suffix = m.group(1).lstrip("0") or "0"

    like_pattern = f"%{clean}%"

    if numeric_suffix:
        sql = (
            "SELECT id AS outlet_id, code, name FROM cdc.outlet FINAL "
            "WHERE lower(name) LIKE lower({like:String}) "
            "OR lower(code) LIKE lower({like:String}) "
            "OR lower(replaceRegexpAll(code, '-0+', '-')) = lower({clean:String}) "
            "OR replaceRegexpAll(code, '^.*-0*', '') = {suffix:String} "
            "OR lower(name) LIKE lower({suffix_like:String}) "
            "ORDER BY code LIMIT {lim:UInt16}"
        )
        params = {
            "like": like_pattern,
            "clean": clean,
            "suffix": numeric_suffix,
            "suffix_like": f"%-{numeric_suffix}%",
            "lim": int(limit),
        }
    else:
        sql = (
            "SELECT id AS outlet_id, code, name FROM cdc.outlet FINAL "
            "WHERE lower(name) LIKE lower({like:String}) "
            "OR lower(code) LIKE lower({like:String}) "
            "OR lower(replaceRegexpAll(code, '-0+', '-')) = lower({clean:String}) "
            "ORDER BY code LIMIT {lim:UInt16}"
        )
        params = {
            "like": like_pattern,
            "clean": clean,
            "lim": int(limit),
        }

    return _execute_parameterized(sql, params)


def fetch_outlet_id_by_code_exact(code: str, limit: int = 5) -> list[dict[str, Any]]:
    """Resolve outlet code exactly before fuzzy aliases like 'Outlet 1'."""
    clean = (code or "").strip()
    if not clean:
        return []

    sql = (
        "SELECT id AS outlet_id, code, name "
        "FROM cdc.outlet FINAL "
        "WHERE lower(code) = lower({code:String}) "
        "OR lower(replaceRegexpAll(code, '-0+', '-')) = lower({code:String}) "
        "ORDER BY code "
        "LIMIT {lim:UInt16}"
    )
    return _execute_parameterized(sql, {"code": clean, "lim": int(limit)})

