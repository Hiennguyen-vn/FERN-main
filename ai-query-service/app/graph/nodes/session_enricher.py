"""Attach session digest + structured presentation metadata before the response is returned."""

from __future__ import annotations

import logging

from app.config import get_settings
from app.graph.state import GraphState
from app.memory.session_digest import build_session_digest
from app.presentation.structured_output import build_presentation_bundle

logger = logging.getLogger(__name__)


def session_enricher(state: GraphState) -> GraphState:
    s = get_settings()
    if not s.session_enricher_enabled:
        return state

    try:
        digest = build_session_digest(state)
        if digest:
            state["session_digest"] = digest
    except Exception as e:  # noqa: BLE001
        logger.warning("session_digest failed (skip): %s", e)

    try:
        presentation = build_presentation_bundle(state)
        if presentation:
            state["presentation"] = presentation
            if presentation.get("chart_spec") and not state.get("chart_spec"):
                state["chart_spec"] = presentation["chart_spec"]
    except Exception as e:  # noqa: BLE001
        logger.warning("presentation bundle failed (skip): %s", e)

    state.setdefault("trace", []).append({"node": "session_enricher"})
    return state
