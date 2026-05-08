"""Self-consistency voting (n>1 parallel runs → pick winning candidate)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

import app.agents.sql_writer_agent as sql_writer_module
from app.auth.context import AuthContext


def _auth() -> AuthContext:
    return AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset({"outlet_manager"}),
        permissions=frozenset(),
        outlet_ids=frozenset({1, 2, 3}),
    )


def _state() -> dict[str, Any]:
    return {
        "raw_question": "doanh thu hằng ngày",
        "normalized_question": "doanh thu hằng ngày",
        "auth": _auth(),
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-07"},
        "resolved_entities": {"outlet_ids": []},
        "trace": [],
    }


def _candidate(
    *, validated: bool, executed: bool, rows: int = 0, final_sql: str | None = "SELECT 1"
) -> tuple[dict, dict, dict]:
    final = {"final_sql": final_sql} if final_sql else {"final_sql": None}
    usage = {"steps": 2, "tokens_in": 100, "tokens_out": 50, "tool_calls": []}
    captured = {
        "validated_sql": "SELECT 1 INJECTED" if validated else None,
        "tables_used": ["analytics.ai_sales_daily"] if validated else None,
        "allowed_outlet_ids": [1, 2, 3] if validated else None,
        "rows": [{"x": i} for i in range(rows)] if executed and validated else None,
        "row_count": rows if executed and validated else None,
        "execute_error": None if executed else "ch failed",
    }
    return final, usage, captured


@pytest.mark.asyncio
async def test_self_consistency_picks_validated_and_executed(monkeypatch):
    call_log: list[int] = []
    candidates = [
        # run 0: validated but execute failed → tier 2
        _candidate(validated=True, executed=False, rows=0),
        # run 1: validated AND executed with rows → tier 3 (winner)
        _candidate(validated=True, executed=True, rows=7),
    ]

    async def fake_runner_factory():
        idx = len(call_log)
        call_log.append(idx)
        return candidates[idx]

    final, usage, captured, vote = await sql_writer_module._run_self_consistent(
        n=2, runner=fake_runner_factory
    )
    assert vote["winner"] == 1
    assert captured["validated_sql"] == "SELECT 1 INJECTED"
    assert captured["rows"] == [{"x": i} for i in range(7)]
    assert usage["self_consistency_n"] == 2
    assert usage["self_consistency_winner"] == 1


@pytest.mark.asyncio
async def test_self_consistency_falls_back_to_validated_only_when_no_executed(monkeypatch):
    candidates = [
        _candidate(validated=False, executed=False, rows=0, final_sql="SELECT 2"),
        _candidate(validated=True, executed=False, rows=0),
    ]

    async def fake_runner():
        return candidates.pop(0)

    final, usage, captured, vote = await sql_writer_module._run_self_consistent(
        n=2, runner=fake_runner
    )
    # Validated tier (2) beats raw tier (1).
    assert vote["winner"] == 1
    assert captured["validated_sql"] == "SELECT 1 INJECTED"


@pytest.mark.asyncio
async def test_self_consistency_handles_partial_crash(monkeypatch):
    async def fake_runner():
        # One half crashes, one half succeeds — voter should pick the survivor.
        if not hasattr(fake_runner, "_n"):
            fake_runner._n = 0
        fake_runner._n += 1
        if fake_runner._n == 1:
            raise RuntimeError("openai 5xx")
        return _candidate(validated=True, executed=True, rows=3)

    final, usage, captured, vote = await sql_writer_module._run_self_consistent(
        n=2, runner=fake_runner
    )
    assert captured["rows"] == [{"x": 0}, {"x": 1}, {"x": 2}]
    assert usage["self_consistency_n"] == 2
    assert vote["winner"] != -1


@pytest.mark.asyncio
async def test_self_consistency_n1_skips_voting(monkeypatch):
    async def fake_runner():
        return _candidate(validated=True, executed=True, rows=2)

    final, usage, captured, vote = await sql_writer_module._run_self_consistent(
        n=1, runner=fake_runner
    )
    assert vote["n"] == 1
    assert vote["winner"] == 0
    # Single-shot path must not pollute usage with voting metadata.
    assert "self_consistency_n" not in usage


@pytest.mark.asyncio
async def test_sql_writer_agent_runs_n2_when_configured(monkeypatch):
    """End-to-end: configure n=2 → loop is invoked twice in parallel."""
    runs: list[int] = []

    async def fake_chat_loop(**_kwargs):
        idx = len(runs)
        runs.append(idx)
        validated = idx == 1  # only second run gets a clean validate
        executed = idx == 1
        return _candidate(validated=validated, executed=executed, rows=4 if executed else 0)

    monkeypatch.setattr(sql_writer_module, "_run_chat_loop", fake_chat_loop)

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "sql_writer_self_consistency_n", 2)
    monkeypatch.setattr(get_settings(), "openai_api_mode", "chat")

    out = await sql_writer_module.sql_writer_agent(_state())

    assert len(runs) == 2
    assert out["raw_result"] == [{"x": 0}, {"x": 1}, {"x": 2}, {"x": 3}]
    last_trace = out["trace"][-1]
    assert last_trace["self_consistency"]["n"] == 2
    assert last_trace["self_consistency"]["winner"] == 1
