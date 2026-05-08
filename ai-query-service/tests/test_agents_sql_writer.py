"""Unit tests for the Codex-driven SQL Writer Agent (tool loop)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

import app.agents.sql_writer_agent as sql_writer_module
from app.auth.context import AuthContext

sql_writer_agent = sql_writer_module.sql_writer_agent


@pytest.fixture(autouse=True)
def _sql_writer_chat_mode(monkeypatch):
    """Fake OpenAI clients here only implement Chat Completions, not Responses."""
    import app.config as cfg
    from app.config import get_settings

    s = get_settings()
    monkeypatch.setattr(
        cfg,
        "_settings",
        s.model_copy(
            update={
                "openai_api_mode": "chat",
                "openai_responses_previous_response_id_enabled": True,
            }
        ),
    )


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
        "raw_question": "doanh thu hằng ngày tuần này",
        "normalized_question": "doanh thu hằng ngày tuần này",
        "auth": _auth(),
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-07"},
        "resolved_entities": {"outlet_ids": []},
        "trace": [],
    }


@pytest.mark.asyncio
async def test_sql_writer_agent_uses_deterministic_mom_outlet_growth(monkeypatch):
    state = _state()
    state["raw_question"] = "top 5 outlet có growth doanh thu cao nhất tháng này so với tháng trước"
    state["normalized_question"] = state["raw_question"]
    state["intent"] = "outlet_compare"

    def fail_get_client():
        raise AssertionError("LLM should not be called for deterministic MoM growth")

    monkeypatch.setattr(sql_writer_module, "get_client", fail_get_client)

    captured = {"sql": ""}

    def fake_validate_and_inject_factory(ctx):
        def _exec(sql: str):
            captured["sql"] = sql
            return {
                "ok": True,
                "errors": [],
                "final_sql": sql + " AND outlet_id IN (1,2,3) LIMIT 1000",
                "allowed_outlet_ids": sorted(ctx.auth_outlet_ids),
                "tables_used": ["analytics.ai_sales_daily"],
            }

        return sql_writer_module.search_schema_tool.__class__(
            name="validate_and_inject",
            schema={"type": "function", "function": {"name": "validate_and_inject"}},
            execute=_exec,
        )

    monkeypatch.setattr(
        sql_writer_module,
        "make_validate_and_inject_tool",
        fake_validate_and_inject_factory,
    )

    def fake_execute_query_factory(ctx):
        def _exec(sql: str):
            return {"ok": True, "row_count": 1, "rows": [{"outlet_id": 1, "growth_rate": 0.25}]}

        return sql_writer_module.search_schema_tool.__class__(
            name="execute_query",
            schema={"type": "function", "function": {"name": "execute_query"}},
            execute=_exec,
        )

    monkeypatch.setattr(
        sql_writer_module,
        "make_execute_query_tool",
        fake_execute_query_factory,
    )

    out = await sql_writer_agent(state)

    assert "analytics.ai_sales_daily" in captured["sql"]
    assert "sumIf" in captured["sql"]
    assert out["final_sql"]
    assert out["execution_error"] is None
    assert out["codegen_tables_used"] == ["analytics.ai_sales_daily"]


def test_previous_response_id_unsupported_detection():
    exc = RuntimeError("Unsupported parameter: previous_response_id")
    assert sql_writer_module._is_previous_response_id_unsupported(exc) is True
    assert sql_writer_module._is_previous_response_id_unsupported(RuntimeError("timeout")) is False


class _FakeChoice:
    def __init__(self, content: str | None, tool_calls=None):
        self.message = SimpleNamespace(content=content, tool_calls=tool_calls or [])


class _FakeUsage:
    def __init__(self, p=10, c=5):
        self.prompt_tokens = p
        self.completion_tokens = c


class _FakeResp:
    def __init__(self, content: str | None, tool_calls=None):
        self.choices = [_FakeChoice(content=content, tool_calls=tool_calls)]
        self.usage = _FakeUsage()


def _tool_call(idx: int, name: str, args: dict[str, Any]):
    return SimpleNamespace(
        id=f"call_{idx}",
        function=SimpleNamespace(name=name, arguments=json.dumps(args)),
    )


class _FakeAsyncOpenAI:
    """A stub AsyncOpenAI client that returns scripted responses in order."""

    def __init__(self, scripted: list[_FakeResp]):
        self._scripted = list(scripted)
        self.calls: list[dict[str, Any]] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):  # noqa: D401
        self.calls.append(kwargs)
        if not self._scripted:
            raise RuntimeError("scripted responses exhausted")
        return self._scripted.pop(0)


@pytest.mark.asyncio
async def test_sql_writer_agent_skips_when_template_key_present(monkeypatch):
    state = _state()
    state["template_key"] = "T01_daily_revenue"

    out = await sql_writer_agent(state)

    assert out["trace"][-1]["skipped"] == "template_path"
    assert "final_sql" not in out


@pytest.mark.asyncio
async def test_sql_writer_agent_uses_chat_when_response_chaining_disabled(monkeypatch):
    import app.config as cfg
    from app.config import get_settings

    s = get_settings()
    monkeypatch.setattr(
        cfg,
        "_settings",
        s.model_copy(
            update={
                "openai_api_mode": "responses",
                "openai_responses_previous_response_id_enabled": False,
            }
        ),
    )
    monkeypatch.setattr(sql_writer_module, "get_client", lambda: object())

    async def fail_responses(**_kwargs):
        raise AssertionError("responses loop should be disabled")

    async def fake_chat_loop(**_kwargs):
        return (
            {"final_sql": "SELECT 1 FROM analytics.ai_sales_daily"},
            {"api_mode": "chat", "tokens_in": 1, "tokens_out": 1, "tokens_cached": 0},
            {
                "validated_sql": "SELECT 1 FROM analytics.ai_sales_daily",
                "tables_used": ["analytics.ai_sales_daily"],
                "rows": [],
            },
        )

    monkeypatch.setattr(sql_writer_module, "_run_responses_loop", fail_responses)
    monkeypatch.setattr(sql_writer_module, "_run_chat_loop", fake_chat_loop)

    out = await sql_writer_agent(_state())

    assert out["sql_source"] == "codegen"
    assert out["executed_sql_source"] == "codegen"
    assert out["trace"][-1]["api_mode"] == "chat"


@pytest.mark.asyncio
async def test_sql_writer_agent_validates_and_executes_with_tools(monkeypatch):
    """End-to-end happy path: LLM calls validate_and_inject → execute_query → emits final JSON."""

    proposed_sql = (
        "SELECT business_date, sum(net_revenue) AS revenue "
        "FROM analytics.ai_sales_daily "
        "WHERE business_date BETWEEN toDate('2026-05-01') AND toDate('2026-05-07') "
        "GROUP BY business_date"
    )

    scripted = [
        # Step 1: model emits a validate_and_inject tool_call
        _FakeResp(
            content=None,
            tool_calls=[_tool_call(1, "validate_and_inject", {"sql": proposed_sql})],
        ),
        # Step 2: model emits an execute_query tool_call (uses validated SQL)
        _FakeResp(
            content=None,
            tool_calls=[
                _tool_call(
                    2,
                    "execute_query",
                    {"sql": proposed_sql + " AND outlet_id IN (1,2,3) LIMIT 1000"},
                )
            ],
        ),
        # Step 3: model emits final JSON
        _FakeResp(
            content=json.dumps(
                {
                    "final_sql": proposed_sql,
                    "row_count": 7,
                    "rationale_vi": "Dùng metric view doanh thu ngày.",
                    "tables_used": ["analytics.ai_sales_daily"],
                }
            ),
        ),
    ]
    fake_client = _FakeAsyncOpenAI(scripted)
    import app.llm.openai_client as openai_client_module

    monkeypatch.setattr(sql_writer_module, "get_client", lambda: fake_client)
    monkeypatch.setattr(openai_client_module, "get_client", lambda: fake_client)
    monkeypatch.setattr(openai_client_module, "_client", fake_client)

    # Patch ClickHouse-touching tools so the test runs without a live cluster.
    captured_validate = {"called": False}

    def fake_validate_and_inject_factory(ctx):
        def _exec(sql: str):
            captured_validate["called"] = True
            captured_validate["sql"] = sql
            return {
                "ok": True,
                "errors": [],
                "final_sql": sql + " AND outlet_id IN (1,2,3) LIMIT 1000",
                "allowed_outlet_ids": sorted(ctx.auth_outlet_ids),
                "tables_used": ["analytics.ai_sales_daily"],
            }

        return sql_writer_module.search_schema_tool.__class__(
            name="validate_and_inject",
            schema={"type": "function", "function": {"name": "validate_and_inject"}},
            execute=_exec,
        )

    monkeypatch.setattr(
        sql_writer_module,
        "make_validate_and_inject_tool",
        fake_validate_and_inject_factory,
    )

    fake_rows = [{"business_date": "2026-05-01", "revenue": 1234567}]

    def fake_execute_query_factory(ctx):
        def _exec(sql: str):
            return {"ok": True, "row_count": len(fake_rows), "rows": fake_rows}

        return sql_writer_module.search_schema_tool.__class__(
            name="execute_query",
            schema={"type": "function", "function": {"name": "execute_query"}},
            execute=_exec,
        )

    monkeypatch.setattr(
        sql_writer_module,
        "make_execute_query_tool",
        fake_execute_query_factory,
    )

    out = await sql_writer_agent(_state())

    assert captured_validate["called"]
    assert out["final_sql"]
    assert out["sql_source"] == "codegen"
    assert out["executed_sql_source"] == "codegen"
    assert out["raw_result"] == fake_rows
    assert out["execution_error"] is None
    assert out["allowed_outlet_ids"] == [1, 2, 3]
    assert out["codegen_tables_used"] == ["analytics.ai_sales_daily"]


@pytest.mark.asyncio
async def test_sql_writer_agent_self_corrects_on_validate_failure(monkeypatch):
    """Validate fails first → agent rewrites SQL on the next turn → succeeds."""

    bad_sql = "SELECT * FROM cdc.outlet"  # no time filter, lookup-only, etc.
    good_sql = (
        "SELECT business_date, sum(net_revenue) AS revenue "
        "FROM analytics.ai_sales_daily "
        "WHERE business_date BETWEEN toDate('2026-05-01') AND toDate('2026-05-07') "
        "GROUP BY business_date"
    )

    scripted = [
        _FakeResp(
            content=None,
            tool_calls=[_tool_call(1, "validate_and_inject", {"sql": bad_sql})],
        ),
        _FakeResp(
            content=None,
            tool_calls=[_tool_call(2, "validate_and_inject", {"sql": good_sql})],
        ),
        _FakeResp(
            content=None,
            tool_calls=[_tool_call(3, "execute_query", {"sql": good_sql})],
        ),
        _FakeResp(
            content=json.dumps(
                {
                    "final_sql": good_sql,
                    "row_count": 7,
                    "rationale_vi": "Đã sửa: dùng metric view có time filter.",
                    "tables_used": ["analytics.ai_sales_daily"],
                }
            ),
        ),
    ]
    fake_client = _FakeAsyncOpenAI(scripted)
    import app.llm.openai_client as openai_client_module

    monkeypatch.setattr(sql_writer_module, "get_client", lambda: fake_client)
    monkeypatch.setattr(openai_client_module, "get_client", lambda: fake_client)
    monkeypatch.setattr(openai_client_module, "_client", fake_client)

    call_log: list[str] = []

    def fake_validate_and_inject_factory(ctx):
        def _exec(sql: str):
            call_log.append(sql)
            if sql.strip() == bad_sql:
                return {
                    "ok": False,
                    "errors": [
                        "lookup-only table cdc.outlet cannot be primary",
                        "Tables outside candidate pack",
                    ],
                    "final_sql": None,
                }
            return {
                "ok": True,
                "errors": [],
                "final_sql": sql + " AND outlet_id IN (1,2,3) LIMIT 1000",
                "allowed_outlet_ids": [1, 2, 3],
                "tables_used": ["analytics.ai_sales_daily"],
            }

        return sql_writer_module.search_schema_tool.__class__(
            name="validate_and_inject",
            schema={"type": "function", "function": {"name": "validate_and_inject"}},
            execute=_exec,
        )

    monkeypatch.setattr(
        sql_writer_module,
        "make_validate_and_inject_tool",
        fake_validate_and_inject_factory,
    )

    def fake_execute_query_factory(ctx):
        def _exec(sql: str):
            return {"ok": True, "row_count": 1, "rows": [{"business_date": "2026-05-01", "revenue": 1}]}

        return sql_writer_module.search_schema_tool.__class__(
            name="execute_query",
            schema={"type": "function", "function": {"name": "execute_query"}},
            execute=_exec,
        )

    monkeypatch.setattr(
        sql_writer_module,
        "make_execute_query_tool",
        fake_execute_query_factory,
    )

    out = await sql_writer_agent(_state())

    assert len(call_log) == 2  # one bad, one good
    assert out["final_sql"]
    assert out["execution_error"] is None
    # The trace should record self-correction implicitly via tool_calls list.
    last_trace = out["trace"][-1]
    assert "validate_and_inject" in last_trace["tool_calls"]
    # validate_and_inject was called twice → self-correction happened
    assert last_trace["tool_calls"].count("validate_and_inject") == 2


@pytest.mark.asyncio
async def test_sql_writer_agent_unsupported_when_validate_keeps_failing(monkeypatch):
    bad_sql = "SELECT * FROM not.allowed"
    scripted = [
        _FakeResp(
            content=None,
            tool_calls=[_tool_call(1, "validate_and_inject", {"sql": bad_sql})],
        ),
        _FakeResp(
            content=None,
            tool_calls=[_tool_call(2, "validate_and_inject", {"sql": bad_sql})],
        ),
        _FakeResp(
            content=json.dumps(
                {
                    "final_sql": None,
                    "error": "không thể sinh truy vấn an toàn cho metric này",
                    "errors": ["Tables outside candidate pack"],
                }
            ),
        ),
    ]
    fake_client = _FakeAsyncOpenAI(scripted)
    import app.llm.openai_client as openai_client_module

    monkeypatch.setattr(sql_writer_module, "get_client", lambda: fake_client)
    monkeypatch.setattr(openai_client_module, "get_client", lambda: fake_client)
    monkeypatch.setattr(openai_client_module, "_client", fake_client)

    def fake_validate_and_inject_factory(ctx):
        def _exec(sql: str):
            return {"ok": False, "errors": ["Tables outside candidate pack"], "final_sql": None}

        return sql_writer_module.search_schema_tool.__class__(
            name="validate_and_inject",
            schema={"type": "function", "function": {"name": "validate_and_inject"}},
            execute=_exec,
        )

    monkeypatch.setattr(
        sql_writer_module,
        "make_validate_and_inject_tool",
        fake_validate_and_inject_factory,
    )

    out = await sql_writer_agent(_state())

    assert "final_sql" not in out or not out.get("final_sql")
    assert out["response_kind"] == "unsupported"
    assert out["escalation_candidate"] is True
    assert out["escalation_target"] == "review_request"
