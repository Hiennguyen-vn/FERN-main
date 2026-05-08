"""Responses API tool-loop with previous_response_id chaining."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

import app.agents.sql_writer_agent as sql_writer_module
import app.llm.openai_client as openai_client_module
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


class _RespUsage:
    def __init__(self, in_tok=10, out_tok=5, cached=4):
        self.input_tokens = in_tok
        self.output_tokens = out_tok
        self.input_tokens_details = SimpleNamespace(cached_tokens=cached)


def _function_call(call_id: str, name: str, args: dict[str, Any]):
    return SimpleNamespace(
        type="function_call",
        id=call_id,
        call_id=call_id,
        name=name,
        arguments=json.dumps(args),
    )


def _final_text_response(rid: str, text: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=rid,
        output=[
            SimpleNamespace(
                type="message",
                content=[SimpleNamespace(text=text)],
            )
        ],
        output_text=text,
        usage=_RespUsage(in_tok=20, out_tok=10, cached=18),
    )


def _tool_call_response(rid: str, calls: list[SimpleNamespace]) -> SimpleNamespace:
    return SimpleNamespace(
        id=rid,
        output=calls,
        output_text="",
        usage=_RespUsage(in_tok=20, out_tok=8, cached=18),
    )


@pytest.mark.asyncio
async def test_responses_loop_chains_previous_response_id(monkeypatch):
    """Responses API path:
    - Turn 1 sends instructions (system prompt) and full user input.
    - Turn 2 sends ONLY function_call_output items + previous_response_id.
    - Cache hits accumulate via tokens_cached.
    """
    captured_calls: list[dict[str, Any]] = []

    async def fake_responses_create(**kwargs):
        captured_calls.append(kwargs)
        n = len(captured_calls)
        if n == 1:
            return _tool_call_response(
                "resp_1",
                [
                    _function_call(
                        "call_v1",
                        "validate_and_inject",
                        {"sql": "SELECT 1 FROM analytics.ai_sales_daily"},
                    )
                ],
            )
        if n == 2:
            return _tool_call_response(
                "resp_2",
                [
                    _function_call(
                        "call_e1",
                        "execute_query",
                        {"sql": "SELECT 1 FROM analytics.ai_sales_daily LIMIT 1"},
                    )
                ],
            )
        return _final_text_response(
            "resp_3",
            json.dumps(
                {
                    "final_sql": "SELECT 1 FROM analytics.ai_sales_daily",
                    "row_count": 1,
                    "rationale_vi": "ok",
                    "tables_used": ["analytics.ai_sales_daily"],
                }
            ),
        )

    fake_client = SimpleNamespace(
        responses=SimpleNamespace(create=fake_responses_create),
    )
    monkeypatch.setattr(openai_client_module, "_client", fake_client)
    monkeypatch.setattr(openai_client_module, "get_client", lambda: fake_client)
    monkeypatch.setattr(sql_writer_module, "get_client", lambda: fake_client)

    monkeypatch.setattr(
        sql_writer_module,
        "make_validate_and_inject_tool",
        lambda ctx: sql_writer_module.search_schema_tool.__class__(
            name="validate_and_inject",
            schema={"type": "function", "function": {"name": "validate_and_inject"}},
            execute=lambda sql: {
                "ok": True,
                "errors": [],
                "final_sql": sql + " AND outlet_id IN (1,2,3)",
                "tables_used": ["analytics.ai_sales_daily"],
                "allowed_outlet_ids": [1, 2, 3],
            },
        ),
    )
    monkeypatch.setattr(
        sql_writer_module,
        "make_execute_query_tool",
        lambda ctx: sql_writer_module.search_schema_tool.__class__(
            name="execute_query",
            schema={"type": "function", "function": {"name": "execute_query"}},
            execute=lambda sql: {"ok": True, "row_count": 1, "rows": [{"x": 1}]},
        ),
    )

    # Force responses API mode for this test only.
    from app.config import get_settings

    monkeypatch.setattr(
        get_settings(),
        "openai_api_mode",
        "responses",
    )
    monkeypatch.setattr(
        get_settings(),
        "openai_responses_previous_response_id_enabled",
        True,
    )
    monkeypatch.setattr(
        get_settings(),
        "sql_writer_self_consistency_n",
        1,
    )

    out = await sql_writer_module.sql_writer_agent(_state())

    # Three turns: tool_call → tool_call → final.
    assert len(captured_calls) == 3
    # Turn 1: full instructions + string input.
    assert "instructions" in captured_calls[0]
    assert isinstance(captured_calls[0]["input"], str)
    assert "previous_response_id" not in captured_calls[0]

    # Turn 2: NO instructions (server reuses prior); previous_response_id chained.
    assert captured_calls[1].get("previous_response_id") == "resp_1"
    assert "instructions" not in captured_calls[1]
    assert isinstance(captured_calls[1]["input"], list)
    assert captured_calls[1]["input"][0]["type"] == "function_call_output"
    assert captured_calls[1]["input"][0]["call_id"] == "call_v1"

    # Turn 3: chained from resp_2.
    assert captured_calls[2].get("previous_response_id") == "resp_2"
    assert isinstance(captured_calls[2]["input"], list)
    assert captured_calls[2]["input"][0]["type"] == "function_call_output"
    assert captured_calls[2]["input"][0]["call_id"] == "call_e1"

    # State must reflect successful execution.
    assert out["final_sql"]
    assert out["sql_source"] == "codegen"
    assert out["raw_result"] == [{"x": 1}]

    # Trace must record api_mode + cached-token telemetry.
    last_trace = out["trace"][-1]
    assert last_trace["api_mode"] == "responses"
    assert last_trace["tokens_cached"] >= 1


@pytest.mark.asyncio
async def test_llm_call_json_passes_previous_response_id(monkeypatch):
    """llm_call_json must forward previous_response_id when in responses mode."""
    captured: dict[str, Any] = {}

    async def fake_responses_create(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            id="resp_X",
            output=[],
            output_text=json.dumps({"foo": "bar"}),
            usage=_RespUsage(in_tok=5, out_tok=2, cached=3),
        )

    fake_client = SimpleNamespace(responses=SimpleNamespace(create=fake_responses_create))
    monkeypatch.setattr(openai_client_module, "_client", fake_client)
    monkeypatch.setattr(openai_client_module, "get_client", lambda: fake_client)

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "openai_api_mode", "responses")
    monkeypatch.setattr(get_settings(), "openai_responses_previous_response_id_enabled", True)

    parsed, usage = await openai_client_module.llm_call_json(
        system_prompt="sys",
        user_prompt="hello",
        json_schema={"name": "x", "schema": {"type": "object"}},
        agent="supervisor",
        previous_response_id="resp_PREV",
    )

    assert parsed == {"foo": "bar"}
    assert captured["previous_response_id"] == "resp_PREV"
    assert usage["response_id"] == "resp_X"
    assert usage["tokens_cached"] == 3


@pytest.mark.asyncio
async def test_llm_call_json_omits_previous_response_id_when_disabled(monkeypatch):
    captured: dict[str, Any] = {}

    async def fake_responses_create(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            id="resp_X",
            output=[],
            output_text=json.dumps({"foo": "bar"}),
            usage=_RespUsage(in_tok=5, out_tok=2, cached=3),
        )

    fake_client = SimpleNamespace(responses=SimpleNamespace(create=fake_responses_create))
    monkeypatch.setattr(openai_client_module, "_client", fake_client)
    monkeypatch.setattr(openai_client_module, "get_client", lambda: fake_client)

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "openai_api_mode", "responses")
    monkeypatch.setattr(get_settings(), "openai_responses_previous_response_id_enabled", False)

    parsed, usage = await openai_client_module.llm_call_json(
        system_prompt="sys",
        user_prompt="hello",
        json_schema={"name": "x", "schema": {"type": "object"}},
        agent="supervisor",
        previous_response_id="resp_PREV",
    )

    assert parsed == {"foo": "bar"}
    assert "previous_response_id" not in captured
    assert usage["response_id"] == "resp_X"
