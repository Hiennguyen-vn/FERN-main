"""Pre-query semantic metadata context.

This node retrieves/derives business definitions, aliases, and preferred metric
tables before LLM planning. It never reads raw business rows.
"""

from __future__ import annotations

import logging

from app.clients.opensearch import hybrid_search_metadata
from app.config import get_settings
from app.graph.nodes.contextualizer import effective_question
from app.graph.state import GraphState
from app.query_policy import format_metadata_context

logger = logging.getLogger(__name__)


def _should_include_fallbacks(state: GraphState, settings) -> bool:
    if not getattr(settings, "agent_extended_dataset_access_enabled", True):
        return False
    frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    task = str(frame.get("task_type") or "")
    domain = str(frame.get("domain") or "")
    return task in {"sales_detail", "peak_hour_analysis", "inventory", "pnl"} or domain in {"payment", "inventory", "pnl"}


def metadata_context(state: GraphState) -> GraphState:
    s = get_settings()
    intent = state.get("intent") or ""
    if not s.metadata_context_enabled:
        state.setdefault("trace", []).append({"node": "metadata_context", "skipped": True, "reason": "disabled"})
        return state
    if intent in ("hr_staff", "greeting", "thanks"):
        state.setdefault("trace", []).append({"node": "metadata_context", "skipped": True, "reason": intent})
        return state

    question = effective_question(state)
    if not question:
        state.setdefault("trace", []).append({"node": "metadata_context", "skipped": True, "reason": "empty"})
        return state

    hits: list[dict] = []
    if s.opensearch_enabled:
        try:
            # Keep this node synchronous and cheap. BM25/fuzzy metadata hits complement
            # deterministic local policy matches; embedding retrieval is handled by seed/search clients elsewhere.
            hits = hybrid_search_metadata(text=question, embedding=None, size=s.metadata_context_max_hits)
        except Exception as e:  # noqa: BLE001
            logger.warning("metadata OpenSearch search failed: %s", e)
            hits = []

    text = format_metadata_context(
        question=question,
        intent=intent,
        os_hits=hits,
        max_chars=s.metadata_context_max_chars,
        include_fallbacks=_should_include_fallbacks(state, s),
    )
    state["metadata_context"] = text if text else None
    state.setdefault("trace", []).append({"node": "metadata_context", "hits": len(hits), "chars": len(text or "")})
    return state


def format_metadata_context_for_prompt(blob: str | None) -> str:
    if not blob or not str(blob).strip():
        return ""
    return "\nNgữ cảnh metadata nghiệp vụ (đã resolve trước query — không phải số liệu):\n" + blob.strip() + "\n"
