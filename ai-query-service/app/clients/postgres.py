"""Small read-only Postgres client for controlled HR lookups.

This is intentionally narrower than a general SQL executor: callers pass static
queries plus bound parameters, and the connection is configured read-only.
"""
from typing import Any

from app.config import get_settings


def _connect():
    s = get_settings()
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - exercised in container/runtime packaging
        raise RuntimeError("psycopg is required for Postgres HR queries") from exc

    timeout_ms = max(1, int(s.postgres_statement_timeout_seconds)) * 1000
    return psycopg.connect(
        host=s.postgres_host,
        port=s.postgres_port,
        dbname=s.postgres_db,
        user=s.postgres_user,
        password=s.postgres_password,
        autocommit=True,
        row_factory=dict_row,
        options=f"-c default_transaction_read_only=on -c statement_timeout={timeout_ms}",
        application_name="fern-ai-query-service",
    )


def execute_readonly(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Execute a static read-only SELECT/WITH query and return dict rows."""
    first_token = sql.lstrip().split(None, 1)[0].lower() if sql.strip() else ""
    if first_token not in {"select", "with"}:
        raise ValueError("Postgres client only allows SELECT/WITH queries")

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            rows = cur.fetchall()
    return [dict(row) for row in rows]


def search_outlets(term: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Resolve outlet names/codes from Postgres for HR queries."""
    cleaned = " ".join(term.strip().split())
    if not cleaned:
        return []
    return execute_readonly(
        """
        SELECT id AS outlet_id, code AS outlet_code, name AS outlet_name
        FROM core.outlet
        WHERE deleted_at IS NULL
          AND (
            lower(code) = lower(%(term)s)
            OR lower(regexp_replace(code, '-0+', '-', 'g')) = lower(%(term)s)
            OR lower(name) LIKE lower(%(pattern)s)
            OR lower(code) LIKE lower(%(pattern)s)
          )
        ORDER BY
          CASE
            WHEN lower(code) = lower(%(term)s) THEN 0
            WHEN lower(regexp_replace(code, '-0+', '-', 'g')) = lower(%(term)s) THEN 1
            WHEN lower(code) LIKE lower(%(pattern)s) THEN 2
            ELSE 3
          END,
          code
        LIMIT %(limit)s
        """,
        {"term": cleaned, "pattern": f"%{cleaned}%", "limit": int(limit)},
    )
