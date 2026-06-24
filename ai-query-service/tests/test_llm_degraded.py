import pytest

from app.agents.sql_writer_agent import sql_writer_agent
from app.graph.state import GraphState
from app.llm.degraded import apply_sql_writer_llm_degraded, apply_supervisor_llm_degraded
from app.llm.openai_client import LLMUnavailableError


def test_apply_supervisor_degraded_with_verified_template():
    state: GraphState = {"trace": []}
    verified = {"template_key": "T01_REVENUE", "template_params": {"from_date": "2026-01-01"}, "confidence": 0.99}
    apply_supervisor_llm_degraded(
        state,
        reason="down",
        verified=verified,
        intent_hint="revenue",
        time_range={"from_date": "2026-01-01", "to_date": "2026-01-31"},
    )
    assert state["template_key"] == "T01_REVENUE"
    assert state["needs_sql_writer"] is False
    assert state["llm_degraded"] is True
    assert state["template_cache_source"] == "verified_query_llm_unavailable"


def test_apply_supervisor_degraded_blocks_low_confidence_verified_template():
    state: GraphState = {"trace": []}
    verified = {"template_key": "T01_REVENUE", "template_params": {"from_date": "2026-01-01"}, "confidence": 0.7}
    apply_supervisor_llm_degraded(
        state,
        reason="down",
        verified=verified,
        intent_hint="revenue",
        time_range={"from_date": "2026-01-01", "to_date": "2026-01-31"},
    )
    assert state["template_key"] is None
    assert state["response_kind"] == "clarification"
    assert state["template_cache_source"] == "blocked_llm_unavailable_low_confidence"


def test_apply_sql_writer_degraded_no_sql():
    state: GraphState = {"trace": [], "final_sql": "SELECT 1"}
    apply_sql_writer_llm_degraded(state, reason="providers down")
    assert state["needs_sql_writer"] is False
    assert state.get("final_sql") == ""
    assert state["response_kind"] == "unsupported"
    assert state["execution_error"] is None


@pytest.mark.asyncio
async def test_sql_writer_llm_unavailable_degrades(monkeypatch):
    async def _boom(n, runner):
        raise LLMUnavailableError("all down")

    monkeypatch.setattr("app.agents.sql_writer_agent._run_self_consistent", _boom)
    state: GraphState = {
        "trace": [],
        "auth": type("A", (), {"outlet_ids": frozenset({1}), "roles": frozenset(), "permissions": frozenset()})(),
        "intent": "revenue",
        "normalized_question": "doanh thu hôm nay",
        "time_range": {"from_date": "2026-01-01", "to_date": "2026-01-01"},
        "allowed_outlet_ids": [1],
    }
    out = await sql_writer_agent(state)
    assert out.get("llm_degraded") is True
    assert out.get("needs_sql_writer") is False
    assert not (out.get("final_sql") or "").strip()
