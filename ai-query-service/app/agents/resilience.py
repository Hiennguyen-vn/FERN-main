"""Per-node resilience wrappers for the agent graph.

Wraps async LangGraph nodes with a wall-clock budget so a hung node (most
often a stalled LLM call) degrades the request gracefully instead of blocking
indefinitely. Sync nodes are deterministic and fast, so they pass through
untouched.

The budget is read at call time from ``settings.llm_node_timeout_seconds``;
``0`` disables the guard (the OpenAI SDK timeout + cross-provider failover
already bound individual calls).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from app.config import get_settings
from app.graph.state import GraphState

logger = logging.getLogger(__name__)

# Degrade policies on timeout:
#   "routing" — node feeds routing (e.g. supervisor); without it we cannot
#               continue, so ask the user to retry/clarify.
#   "data"    — data-producing lane; mark execution_error so the formatter
#               returns a graceful "could not complete" message.
#   "soft"    — enrichment/post-answer node; skip it and keep the answer.
TimeoutPolicy = str

_RETRY_MESSAGE = "Hệ thống đang xử lý lâu hơn bình thường, bạn vui lòng thử lại câu hỏi sau giây lát."

NodeFn = Callable[[GraphState], Awaitable[GraphState]]


def _degrade(state: GraphState, name: str, policy: TimeoutPolicy) -> GraphState:
    state.setdefault("trace", []).append({"node": name, "timeout": True, "policy": policy})
    if policy == "routing":
        state["response_kind"] = "clarification"
        state["needs_sql_writer"] = False
        if not (state.get("clarification_question") or "").strip():
            state["clarification_question"] = _RETRY_MESSAGE
    elif policy == "data":
        state["execution_error"] = f"node_timeout:{name}"
    # "soft": leave the state unchanged so a produced answer survives.
    return state


def with_node_timeout(name: str, fn: NodeFn, *, on_timeout: TimeoutPolicy = "soft") -> NodeFn:
    """Wrap an async node with the configured wall-clock budget.

    Returns ``fn`` unchanged when it is not a coroutine function (sync nodes
    are not subject to the budget).
    """
    if not asyncio.iscoroutinefunction(fn):
        return fn

    async def wrapped(state: GraphState) -> GraphState:
        budget = float(getattr(get_settings(), "llm_node_timeout_seconds", 0.0) or 0.0)
        if budget <= 0:
            return await fn(state)
        try:
            async with asyncio.timeout(budget):
                return await fn(state)
        except (asyncio.TimeoutError, TimeoutError):
            logger.warning(
                "Node '%s' exceeded %.1fs budget; degrading (policy=%s)",
                name,
                budget,
                on_timeout,
            )
            return _degrade(state, name, on_timeout)

    wrapped.__name__ = getattr(fn, "__name__", name)
    return wrapped
