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


def fetch_all_outlet_ids() -> list[int]:
    """Used by RBAC injector for CFO/ADMIN global scope."""
    rows = execute_query("SELECT outlet_id FROM fern.dim_outlet FINAL ORDER BY outlet_id")
    return [int(r["outlet_id"]) for r in rows]


def fetch_outlet_id_by_name_like(term: str, limit: int = 5) -> list[dict[str, Any]]:
    """Fallback for entity_resolver when OpenSearch score is low."""
    safe = term.replace("'", "''").replace("%", "")
    sql = (
        f"SELECT outlet_id, name FROM fern.dim_outlet FINAL "
        f"WHERE lower(name) LIKE lower('%{safe}%') LIMIT {int(limit)}"
    )
    return execute_query(sql)
