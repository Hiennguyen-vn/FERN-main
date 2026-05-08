"""Long-term memory retriever — runs right after preprocess.

Embeds the user's normalized question, performs ANN search in pgvector,
and attaches the surviving nuggets to ``state['relevant_memories']`` so
downstream nodes (supervisor prompt, formatter) can fold them in.
Fail-open: any error here is logged and skipped.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.graph.state import GraphState
from app.memory.kb_store import search_similar, to_dicts

logger = logging.getLogger(__name__)


async def kb_retriever(state: GraphState) -> GraphState:
    s = get_settings()
    if not getattr(s, "agent_kb_enabled", False):
        return state
    if state.get("social_kind"):
        return state

    auth = state.get("auth")
    user_id = int(getattr(auth, "user_id", 0) or 0)
    if user_id <= 0:
        return state

    query = (
        state.get("contextualized_question")
        or state.get("normalized_question")
        or state.get("raw_question")
        or ""
    )
    query = (query or "").strip()
    if not query:
        return state

    try:
        from app.llm.openai_client import embed

        embedding = await embed(query)
    except Exception as e:  # noqa: BLE001
        logger.warning("kb_retriever: embedding failed (skip): %s", e)
        state.setdefault("trace", []).append(
            {"node": "kb_retriever", "skipped": "embedding_failed"}
        )
        return state

    try:
        nuggets = search_similar(
            user_id=user_id,
            query_embedding=embedding,
            top_k=int(s.agent_kb_top_k),
            min_similarity=float(s.agent_kb_min_similarity),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("kb_retriever: search failed (skip): %s", e)
        state.setdefault("trace", []).append(
            {"node": "kb_retriever", "skipped": "search_failed"}
        )
        return state

    if nuggets:
        memories = to_dicts(nuggets)
        state["relevant_memories"] = memories
        # Echo into the conversation context so the supervisor LLM picks it up.
        bullets = "\n".join(f"- {m['summary_vi']}" for m in memories[:5])
        prior = state.get("conversation_context") or ""
        prefix = "Trí nhớ liên quan:\n" + bullets + "\n"
        state["conversation_context"] = (prefix + prior).strip()
    state.setdefault("trace", []).append(
        {"node": "kb_retriever", "matches": len(nuggets)}
    )
    return state
