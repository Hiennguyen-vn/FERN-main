"""Unit tests for the long-term knowledge base + retriever / writer nodes."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date
from typing import Any
from unittest.mock import patch

import pytest

from app.memory.kb_store import (
    KnowledgeNugget,
    _embedding_literal,
    to_dicts,
)
from app.memory.kb_summarizer import build_nugget_from_state


def test_embedding_literal_format():
    out = _embedding_literal([1.0, -2.5, 3.125])
    assert out.startswith("[") and out.endswith("]")
    parts = out[1:-1].split(",")
    assert parts == ["1.000000", "-2.500000", "3.125000"]


def test_summarizer_skips_empty_results():
    assert build_nugget_from_state({"raw_result": []}) is None
    assert build_nugget_from_state({"raw_result": [{"x": 1}], "execution_error": "boom"}) is None
    assert build_nugget_from_state({"raw_result": [{"x": 1}], "social_kind": "thanks"}) is None
    assert build_nugget_from_state({"raw_result": [{"x": 1}], "response_kind": "clarification"}) is None


def test_summarizer_builds_concise_nugget():
    state = {
        "raw_question": "Doanh thu tuần qua tại Quận 1",
        "question_frame": {"effective_question": "Doanh thu tuần qua tại Quận 1"},
        "intent": "revenue",
        "template_key": "T35_weekly_revenue_trend",
        "time_range": {"from_date": "2026-02-01", "to_date": "2026-02-07"},
        "raw_result": [{"week_start": "2026-02-02", "net_revenue": 1234.5}],
        "data_source_context": {"primary_dataset": "analytics.ai_sales_daily"},
        "audience": "executive",
        "response_kind": "answer",
    }
    nugget = build_nugget_from_state(state)
    assert nugget is not None
    assert nugget.intent == "revenue"
    assert nugget.template_key == "T35_weekly_revenue_trend"
    assert nugget.time_range_from == date(2026, 2, 1)
    assert nugget.time_range_to == date(2026, 2, 7)
    assert "doanh thu" in nugget.summary_vi.lower()
    assert "net_revenue" in nugget.summary_vi
    assert nugget.metadata["row_count"] == 1
    assert nugget.metadata["primary_dataset"] == "analytics.ai_sales_daily"


def test_to_dicts_round_trip():
    nuggets = [
        KnowledgeNugget(
            topic="t1",
            summary_vi="s1",
            intent="revenue",
            similarity=0.9123,
            time_range_from=date(2026, 1, 1),
            time_range_to=date(2026, 1, 31),
        )
    ]
    out = to_dicts(nuggets)
    assert out[0]["similarity"] == 0.9123
    assert out[0]["time_range"]["from_date"] == "2026-01-01"


# ─── retriever / writer node tests (no real DB / OpenAI) ────────────────────


@dataclass
class _Auth:
    user_id: int = 7


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_kb_retriever_disabled_settings_no_op():
    from app.graph.nodes import kb_retriever as mod

    class S:
        agent_kb_enabled = False
        agent_kb_top_k = 3
        agent_kb_min_similarity = 0.78

    with patch.object(mod, "get_settings", return_value=S()):
        state = {"normalized_question": "hi", "auth": _Auth()}
        out = _run(mod.kb_retriever(state))
        assert "relevant_memories" not in out


def test_kb_retriever_attaches_memories():
    from app.graph.nodes import kb_retriever as mod

    class S:
        agent_kb_enabled = True
        agent_kb_top_k = 3
        agent_kb_min_similarity = 0.5

    async def fake_embed(_text: str) -> list[float]:
        return [0.1] * 1536

    with patch.object(mod, "get_settings", return_value=S()), patch(
        "app.llm.openai_client.embed", new=fake_embed
    ), patch.object(mod, "search_similar") as ss:
        ss.return_value = [
            KnowledgeNugget(topic="t", summary_vi="trước đó hỏi doanh thu", similarity=0.91)
        ]
        state = {
            "normalized_question": "Doanh thu tuần qua?",
            "auth": _Auth(),
            "trace": [],
        }
        out = _run(mod.kb_retriever(state))
        assert out["relevant_memories"]
        assert "Trí nhớ liên quan:" in out["conversation_context"]


def test_kb_writer_calls_upsert_with_embedding():
    from app.graph.nodes import kb_writer as mod

    class S:
        agent_kb_enabled = True
        openai_embeddings_enabled = True
        openai_embedding_model = "text-embedding-3-small"
        agent_kb_max_summary_chars = 600

    async def fake_embed(_text: str) -> list[float]:
        return [0.0] * 1536

    captured: dict[str, Any] = {}

    def fake_upsert(**kwargs):
        captured.update(kwargs)
        return True

    with patch.object(mod, "get_settings", return_value=S()), patch(
        "app.llm.openai_client.embed", new=fake_embed
    ), patch.object(mod, "upsert_nugget", side_effect=fake_upsert):
        state = {
            "auth": _Auth(),
            "raw_question": "Doanh thu tuần qua",
            "question_frame": {"effective_question": "Doanh thu tuần qua"},
            "intent": "revenue",
            "template_key": "T35_weekly_revenue_trend",
            "time_range": {"from_date": "2026-02-01", "to_date": "2026-02-07"},
            "raw_result": [{"net_revenue": 100}],
            "response_kind": "answer",
            "trace": [],
        }
        out = _run(mod.kb_writer(state))
        assert any(t.get("node") == "kb_writer" and t.get("stored") for t in out["trace"])
        assert captured["user_id"] == 7
        assert captured["intent"] == "revenue"
        assert captured["template_key"] == "T35_weekly_revenue_trend"
        assert captured["embedding"] is not None
        assert captured["embedding_model"] == "text-embedding-3-small"


def test_kb_writer_disabled_no_op():
    from app.graph.nodes import kb_writer as mod

    class S:
        agent_kb_enabled = False
        openai_embeddings_enabled = True
        openai_embedding_model = "x"
        agent_kb_max_summary_chars = 600

    with patch.object(mod, "get_settings", return_value=S()), patch.object(mod, "upsert_nugget") as up:
        state = {
            "auth": _Auth(),
            "raw_result": [{"x": 1}],
            "response_kind": "answer",
            "raw_question": "q",
            "question_frame": {"effective_question": "q"},
            "trace": [],
        }
        _run(mod.kb_writer(state))
        up.assert_not_called()
