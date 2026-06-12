"""LLM degraded-mode helpers.

When every configured provider is unavailable, the service must not attempt
uncontrolled SQL generation. These helpers centralise safe fallbacks:
verified templates when available, otherwise clarification/unsupported.
"""

from __future__ import annotations

import logging
from typing import Any

from app.graph.state import GraphState

logger = logging.getLogger(__name__)

_SAFE_CLARIFICATION = (
    "Dịch vụ AI tạm thời không khả dụng. "
    "Bạn vui lòng thử lại sau giây lát hoặc làm rõ thêm câu hỏi."
)
_SAFE_UNSUPPORTED = (
    "Tôi chưa thể xử lý câu hỏi này lúc này vì dịch vụ AI tạm thời không khả dụng. "
    "Bạn có thể thử lại sau hoặc chọn một báo cáo mẫu có sẵn."
)


def _append_trace(state: GraphState, entry: dict[str, Any]) -> None:
    state.setdefault("trace", []).append(entry)


def mark_llm_degraded(state: GraphState, *, stage: str, reason: str, provider_meta: dict | None = None) -> None:
    state["llm_degraded"] = True
    state["llm_degraded_stage"] = stage
    state["llm_degraded_reason"] = reason[:200]
    if provider_meta:
        state["llm_provider_meta"] = provider_meta
    _append_trace(
        state,
        {
            "node": stage,
            "llm_degraded": True,
            "reason": reason[:120],
            **(provider_meta or {}),
        },
    )
    logger.warning("LLM degraded at %s: %s", stage, reason[:120])


def apply_supervisor_llm_degraded(
    state: GraphState,
    *,
    reason: str,
    verified: dict[str, Any] | None = None,
    intent_hint: str | None = None,
    time_range: dict[str, str] | None = None,
    provider_meta: dict | None = None,
) -> GraphState:
    """Supervisor cannot call LLM — use verified template or safe clarification."""
    mark_llm_degraded(state, stage="supervisor_agent", reason=reason, provider_meta=provider_meta)
    state["needs_sql_writer"] = False

    if verified and verified.get("template_key"):
        state["agent_route"] = "data_query"
        state["template_key"] = verified["template_key"]
        state["template_params"] = dict(verified.get("template_params") or {})
        state["template_confidence"] = 1.0
        state["response_kind"] = "answer"
        state["clarification_question"] = None
        if intent_hint:
            state["intent"] = intent_hint
        if time_range:
            state["time_range"] = time_range
        return state

    state["agent_route"] = "clarification"
    state["response_kind"] = "clarification"
    state["template_key"] = None
    state["clarification_question"] = _SAFE_CLARIFICATION
    return state


def apply_sql_writer_llm_degraded(
    state: GraphState,
    *,
    reason: str,
    provider_meta: dict | None = None,
) -> GraphState:
    """SQL Writer cannot call LLM — never emit unvalidated SQL."""
    mark_llm_degraded(state, stage="sql_writer_agent", reason=reason, provider_meta=provider_meta)
    state["needs_sql_writer"] = False
    state["final_sql"] = ""
    state["guard_passed"] = False
    state["execution_error"] = None
    state["response_kind"] = "unsupported"
    state["clarification_question"] = _SAFE_UNSUPPORTED
    state["escalation_candidate"] = True
    state["escalation_reason"] = "llm_unavailable"
    state["escalation_target"] = "review_request"
    return state
