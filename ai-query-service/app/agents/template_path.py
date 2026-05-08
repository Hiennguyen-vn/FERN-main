"""Deterministic template lane: render → RBAC inject → guard → execute.

This is the high-confidence path that runs **without any LLM** when
``supervisor_agent`` selects a verified template_key. It folds four legacy
nodes into a single graph node so the simplified Finch-style graph stays
shallow (Supervisor → SQLWriter|Template → Formatter).

Failures fall back to the SQL Writer Agent only if explicitly requested by
the supervisor; here we surface validation errors to the formatter.
"""

from __future__ import annotations

import logging
from typing import Callable

from app.clients.clickhouse import execute_query
from app.graph.nodes.validator import validator
from app.graph.nodes.rbac_injector import make_rbac_injector
from app.graph.nodes.sql_guard import sql_guard
from app.graph.state import GraphState

logger = logging.getLogger(__name__)


def make_template_path(all_outlet_ids_provider: Callable[[], list[int]] | None = None):
    """Factory: returns a single graph-node function that runs the
    template lane end-to-end."""

    rbac_injector = make_rbac_injector(all_outlet_ids_provider)

    def template_path(state: GraphState) -> GraphState:
        state.setdefault("trace", [])

        validator(state)
        if state.get("validation_errors"):
            state["trace"].append({"node": "template_path", "stage": "validator_failed"})
            return state

        rbac_injector(state)
        if state.get("validation_errors") or not state.get("final_sql"):
            state["trace"].append({"node": "template_path", "stage": "rbac_failed"})
            return state

        sql_guard(state)
        if not state.get("guard_passed"):
            state["trace"].append({"node": "template_path", "stage": "guard_failed"})
            return state

        sql = state.get("final_sql") or ""
        try:
            rows = execute_query(sql)
            state["raw_result"] = rows
            state["execution_error"] = None
            state["executed_sql_source"] = "template"
            state["trace"].append({"node": "template_path", "stage": "executed", "rows": len(rows)})
        except Exception as exc:  # noqa: BLE001
            logger.warning("template_path execute failed: %s", exc)
            state["execution_error"] = str(exc)[:400]
            state["correction_attempts"] = state.get("correction_attempts", 0) + 1
            state["trace"].append({"node": "template_path", "stage": "execute_error", "error": str(exc)[:200]})

        return state

    return template_path


# Convenience for tests / no-DB unit fixtures: an unbound entry point that
# expects the caller to inject ``all_outlet_ids_provider`` via the factory.
template_path = make_template_path()
