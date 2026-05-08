"""Whitelist-only ClickHouse catalog helpers for matcher prompts (read-only)."""

import logging
from typing import Any

from app.clients.clickhouse import execute_query
from app.query_policy import (
    ALLOWED_FULL_TABLES,
    TABLE_OUTLET_COLUMNS,
    candidate_tables_for_prompt,
    get_table_policy,
    tables_for_intent as policy_tables_for_intent,
)

logger = logging.getLogger(__name__)


def parse_allowed_full_table(full: str) -> tuple[str, str] | None:
    part = full.strip().lower()
    if part not in ALLOWED_FULL_TABLES:
        return None
    db, _, tbl = part.partition(".")
    if not db or not tbl:
        return None
    return db, tbl


def _sql_string_literal(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def fetch_columns_for_table(database: str, table: str, *, max_columns: int = 48) -> list[dict[str, Any]]:
    """Return name/type rows from system.columns for one allow-listed physical table."""
    canonical = f"{database.lower()}.{table.lower()}"
    if canonical not in ALLOWED_FULL_TABLES:
        raise ValueError(f"Table not allow-listed for catalog introspection: {canonical}")

    lim = max(8, min(max_columns, 120))
    sql = f"""
SELECT name, type
FROM system.columns
WHERE lower(database) = lower({_sql_string_literal(database)})
  AND lower(table) = lower({_sql_string_literal(table)})
ORDER BY position
LIMIT {lim:d}
"""
    return execute_query(sql)


def tables_for_intent(intent: str | None, *, max_tables: int) -> list[str]:
    return policy_tables_for_intent(intent, max_tables=max_tables)


def format_catalog_digest(
    intent: str | None,
    *,
    question: str | None = None,
    max_tables: int,
    max_columns_per_table: int,
    max_chars: int,
) -> str:
    """Build a short text digest for LLM prompts; empty string if all lookups fail."""
    chunks: list[str] = []
    candidates = candidate_tables_for_prompt(
        intent,
        question=question,
        max_tables=max_tables,
        include_fallbacks=False,
    )
    if not candidates:
        candidates = tables_for_intent(intent, max_tables=max_tables)
    for full in candidates:
        parsed = parse_allowed_full_table(full)
        if not parsed:
            continue
        db, tbl = parsed
        try:
            rows = fetch_columns_for_table(db, tbl, max_columns=max_columns_per_table)
        except Exception as e:  # noqa: BLE001
            logger.warning("catalog digest skipped %s.%s: %s", db, tbl, e)
            continue
        if not rows:
            continue
        policy = get_table_policy(full)
        lines = [f"{full}:"]
        if policy:
            lines.append(f"  - grain: {policy.grain}")
            if policy.time_column:
                lines.append(f"  - time_column: {policy.time_column}")
            if policy.metrics:
                lines.append(f"  - metrics: {', '.join(policy.metrics)}")
        for r in rows:
            nm = str(r.get("name", ""))
            tp = str(r.get("type", ""))
            if nm:
                lines.append(f"  - {nm}: {tp}")
        chunks.append("\n".join(lines))

    text = "\n\n".join(chunks).strip()
    if max_chars > 200 and len(text) > max_chars:
        return text[: max_chars - 20] + "\n…(đã cắt)"
    return text
