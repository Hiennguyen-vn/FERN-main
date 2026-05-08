"""Attach allow-listed ClickHouse column snapshot into graph state for prompts."""

import logging

from app.config import get_settings
from app.graph.nodes.contextualizer import effective_question
from app.graph.state import GraphState
from app.graph.tools.clickhouse_catalog import format_catalog_digest

logger = logging.getLogger(__name__)


def catalog_digest(state: GraphState) -> GraphState:
    s = get_settings()
    if not s.catalog_digest_enabled:
        state.setdefault("trace", []).append({"node": "catalog_digest", "skipped": True, "reason": "disabled"})
        return state

    intent = state.get("intent") or ""
    if intent in ("hr_staff", "greeting", "thanks"):
        state.setdefault("trace", []).append({"node": "catalog_digest", "skipped": True, "reason": intent})
        return state

    try:
        digest = format_catalog_digest(
            intent,
            question=effective_question(state),
            max_tables=s.catalog_digest_max_tables,
            max_columns_per_table=s.catalog_digest_max_columns_per_table,
            max_chars=s.catalog_digest_max_chars,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("catalog_digest failed: %s", e)
        digest = ""

    state["catalog_digest"] = digest if digest else None
    state.setdefault("trace", []).append(
        {"node": "catalog_digest", "tables_requested": s.catalog_digest_max_tables, "chars": len(digest or "")}
    )
    return state


def format_catalog_digest_for_prompt(blob: str | None) -> str:
    if not blob or not str(blob).strip():
        return ""
    return "\nSnapshot cột (ClickHouse, allow-list — chỉ để chọn template, không coi là số liệu):\n" + blob.strip() + "\n"
