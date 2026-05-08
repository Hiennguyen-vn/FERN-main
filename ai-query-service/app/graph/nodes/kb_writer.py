"""Long-term memory writer — runs at the very end of the agent pipeline.

Builds a draft nugget from the finished state, embeds it once (best-effort),
and upserts to the pgvector knowledge base. Fail-open everywhere — the
user-visible response must not depend on the KB write succeeding.
"""

from __future__ import annotations

import logging

from app.config import get_settings
from app.graph.state import GraphState
from app.memory.kb_store import upsert_nugget
from app.memory.kb_summarizer import build_nugget_from_state

logger = logging.getLogger(__name__)


async def kb_writer(state: GraphState) -> GraphState:
    s = get_settings()
    if not getattr(s, "agent_kb_enabled", False):
        return state

    auth = state.get("auth")
    user_id = int(getattr(auth, "user_id", 0) or 0)
    if user_id <= 0:
        return state

    draft = build_nugget_from_state(state)
    if draft is None:
        return state

    embedding: list[float] | None = None
    embed_model: str | None = None
    if getattr(s, "openai_embeddings_enabled", True):
        try:
            from app.llm.openai_client import embed

            embedding = await embed(draft.summary_vi)
            embed_model = s.openai_embedding_model
        except Exception as e:  # noqa: BLE001
            logger.warning("kb_writer: embed failed (storing without vector): %s", e)
            embedding = None

    ok = upsert_nugget(
        user_id=user_id,
        topic=draft.topic,
        summary_vi=draft.summary_vi,
        embedding=embedding,
        embedding_model=embed_model,
        intent=draft.intent,
        template_key=draft.template_key,
        time_range={
            "from_date": draft.time_range_from.isoformat() if draft.time_range_from else "",
            "to_date": draft.time_range_to.isoformat() if draft.time_range_to else "",
        },
        metadata=draft.metadata,
    )
    state.setdefault("trace", []).append(
        {"node": "kb_writer", "stored": bool(ok), "embedded": embedding is not None}
    )
    return state
