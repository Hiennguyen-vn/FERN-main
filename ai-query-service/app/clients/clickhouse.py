from typing import Any
import re

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


def fetch_all_outlet_ids() -> list[int]:
    """Used by RBAC injector for CFO/ADMIN global scope."""
    rows = execute_query("SELECT id AS outlet_id FROM cdc.outlet FINAL ORDER BY id")
    return [int(r["outlet_id"]) for r in rows]


def fetch_outlet_id_by_name_like(term: str, limit: int = 5) -> list[dict[str, Any]]:
    """Fallback for entity_resolver when OpenSearch score is low."""
    safe = term.replace("'", "''").replace("%", "")
    numeric_suffix = ""
    m = re.search(r"\boutlet\s+(\d{1,6})\b", safe, flags=re.IGNORECASE)
    if m:
        numeric_suffix = m.group(1).lstrip("0") or "0"
    suffix_clause = (
        f"OR replaceRegexpAll(code, '^.*-0*', '') = '{numeric_suffix}' "
        f"OR lower(name) LIKE lower('%-{numeric_suffix}%') "
        if numeric_suffix
        else ""
    )
    sql = (
        f"SELECT id AS outlet_id, code, name FROM cdc.outlet FINAL "
        f"WHERE lower(name) LIKE lower('%{safe}%') "
        f"OR lower(code) LIKE lower('%{safe}%') "
        f"OR lower(replaceRegexpAll(code, '-0+', '-')) = lower('{safe}') "
        f"{suffix_clause}"
        f"ORDER BY code LIMIT {int(limit)}"
    )
    return execute_query(sql)


def fetch_outlet_id_by_code_exact(code: str, limit: int = 5) -> list[dict[str, Any]]:
    """Resolve outlet code exactly before fuzzy aliases like "Outlet 1"."""
    safe = code.strip().replace("'", "''")
    if not safe:
        return []
    sql = (
        "SELECT id AS outlet_id, code, name "
        "FROM cdc.outlet FINAL "
        f"WHERE lower(code) = lower('{safe}') "
        f"OR lower(replaceRegexpAll(code, '-0+', '-')) = lower('{safe}') "
        "ORDER BY code "
        f"LIMIT {int(limit)}"
    )
    return execute_query(sql)
