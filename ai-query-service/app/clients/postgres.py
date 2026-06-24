"""Small read-only Postgres client for controlled HR lookups.

This is intentionally narrower than a general SQL executor: callers pass static
queries plus bound parameters, and the connection is configured read-only.

Connection pooling
------------------
A module-level ``psycopg_pool.ConnectionPool`` is initialised lazily on first
use (``_get_pool``).  The pool size is intentionally small (1–3) because HR
queries are infrequent and we don't want to exhaust Postgres connections.
Re-using connections across requests removes the per-query TCP + auth overhead
that the previous ``_connect()`` approach incurred.

If ``psycopg_pool`` is not installed the code falls back to a direct
per-query connection so the service still starts in environments where the
pool package is absent (e.g. minimal Docker layers during development).
"""
from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

_pool = None  # psycopg_pool.ConnectionPool | None


def _make_conninfo() -> str:
    s = get_settings()
    timeout_ms = max(1, int(s.postgres_statement_timeout_seconds)) * 1000
    # Build a libpq-compatible conninfo string.
    return (
        f"host={s.postgres_host} "
        f"port={s.postgres_port} "
        f"dbname={s.postgres_db} "
        f"user={s.postgres_user} "
        f"password={s.postgres_password} "
        f"application_name=fern-ai-query-service "
        f"options='-c default_transaction_read_only=on -c statement_timeout={timeout_ms}'"
    )


def _get_pool():
    """Return (or lazily create) the shared ConnectionPool.

    Falls back to ``None`` when psycopg_pool is not installed so that
    callers can degrade gracefully to per-query connections.
    """
    global _pool
    if _pool is not None:
        return _pool
    try:
        from psycopg_pool import ConnectionPool  # type: ignore[import]
        from psycopg.rows import dict_row  # noqa: PLC0415

        _pool = ConnectionPool(
            conninfo=_make_conninfo(),
            min_size=1,
            max_size=3,
            kwargs={"row_factory": dict_row, "autocommit": True},
            open=True,
        )
        logger.info("Postgres connection pool initialised (min=1, max=3)")
    except ImportError:
        logger.warning(
            "psycopg_pool not installed — falling back to per-query connections. "
            "Install psycopg[pool] for connection reuse."
        )
        _pool = None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Postgres pool init failed, will use per-query fallback: %s", exc)
        _pool = None
    return _pool


def _connect_direct():
    """Create a single direct connection (fallback when pool is unavailable)."""
    s = get_settings()
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover
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

    pool = _get_pool()

    if pool is not None:
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params or {})
                rows = cur.fetchall()
        return [dict(row) for row in rows]

    # Fallback: per-query connection
    with _connect_direct() as conn:
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


def fetch_all_outlet_ids() -> list[int]:
    """Return active Postgres outlet IDs for HR/RBAC queries."""
    rows = execute_readonly(
        """
        SELECT id AS outlet_id
        FROM core.outlet
        WHERE deleted_at IS NULL
        ORDER BY id
        """,
    )
    return [int(row["outlet_id"]) for row in rows]
