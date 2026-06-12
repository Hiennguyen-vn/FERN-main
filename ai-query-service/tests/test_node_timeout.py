"""Per-node wall-clock timeout / graceful degradation for the agent graph."""

import asyncio

from app.agents import resilience as r


def _settings(budget: float):
    class _S:
        llm_node_timeout_seconds = budget

    return _S()


def test_sync_node_passes_through_unwrapped():
    def node(state):
        return state

    assert r.with_node_timeout("n", node) is node


async def test_disabled_budget_runs_normally(monkeypatch):
    monkeypatch.setattr(r, "get_settings", lambda: _settings(0.0))

    async def node(state):
        state["x"] = 1
        return state

    wrapped = r.with_node_timeout("n", node)
    out = await wrapped({})
    assert out["x"] == 1


async def test_fast_node_within_budget(monkeypatch):
    monkeypatch.setattr(r, "get_settings", lambda: _settings(5.0))

    async def node(state):
        state["x"] = 2
        return state

    out = await r.with_node_timeout("n", node)({})
    assert out["x"] == 2


async def test_timeout_routing_degrades_to_clarification(monkeypatch):
    monkeypatch.setattr(r, "get_settings", lambda: _settings(0.01))

    async def node(state):
        await asyncio.sleep(1)
        return state

    out = await r.with_node_timeout("supervisor_agent", node, on_timeout="routing")({"trace": []})
    assert out["response_kind"] == "clarification"
    assert out["clarification_question"]
    assert out["needs_sql_writer"] is False
    assert out["trace"][-1]["timeout"] is True


async def test_timeout_data_sets_execution_error(monkeypatch):
    monkeypatch.setattr(r, "get_settings", lambda: _settings(0.01))

    async def node(state):
        await asyncio.sleep(1)
        return state

    out = await r.with_node_timeout("sql_writer_agent", node, on_timeout="data")({"trace": []})
    assert out["execution_error"].startswith("node_timeout:")


async def test_timeout_soft_keeps_state(monkeypatch):
    monkeypatch.setattr(r, "get_settings", lambda: _settings(0.01))

    async def node(state):
        await asyncio.sleep(1)
        return state

    out = await r.with_node_timeout("reviewer_agent", node)({"answer_text": "ok", "trace": []})
    # Soft degrade must not clobber an already-produced answer.
    assert out["answer_text"] == "ok"
    assert "response_kind" not in out
    assert out["trace"][-1]["timeout"] is True
