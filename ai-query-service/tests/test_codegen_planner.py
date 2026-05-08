"""Tests for GenSQL SQL planner hop."""

from unittest.mock import AsyncMock, patch

import pytest

from app.query_modes.codegen.planner import codegen_sql_planner, format_sql_plan_for_prompt


def test_format_sql_plan_empty():
    assert format_sql_plan_for_prompt(None) == ""
    assert format_sql_plan_for_prompt({}) == ""


def test_format_sql_plan_nonempty():
    text = format_sql_plan_for_prompt({
        "goal_vi": "Xem doanh thu",
        "primary_tables": ["analytics.fct_sales_daily"],
        "optional_tables": [],
        "grain_vi": "theo ngày",
        "time_binding_vi": "business_date",
        "metric_plan_vi": ["sum(net_revenue)"],
        "join_hints_vi": [],
        "filter_hints_vi": [],
        "risk_notes_vi": [],
        "must_avoid_vi": ["WITH"],
        "logical_steps_vi": [
            "Đọc analytics.fct_sales_daily",
            "Lọc business_date trong khoảng",
            "Tổng net_revenue theo ngày",
        ],
    })
    assert "Kế hoạch SQL" in text
    assert "analytics.fct_sales_daily" in text
    assert "Các bước logic" in text
    assert "Tổng net_revenue" in text


@pytest.mark.asyncio
async def test_planner_skipped_when_disabled(monkeypatch):
    from app.auth.context import AuthContext

    auth = AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset(),
        permissions=frozenset(),
        outlet_ids=frozenset({1}),
        correlation_id="c",
    )

    class S:
        codegen_sql_plan_enabled = False

    monkeypatch.setattr("app.query_modes.codegen.planner.get_settings", lambda: S())

    state = {
        "auth": auth,
        "normalized_question": "Doanh thu 7 ngày",
        "intent": "revenue",
        "time_range": {},
        "resolved_entities": {},
    }
    out = await codegen_sql_planner(state)
    assert "codegen_sql_plan" not in out or out.get("codegen_sql_plan") is None
    assert any(t.get("skipped") for t in out.get("trace", []) if t.get("node") == "codegen_sql_planner")


@pytest.mark.asyncio
async def test_planner_uses_promoted_sql_writer_blueprint_without_llm(monkeypatch):
    from app.auth.context import AuthContext

    auth = AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset(),
        permissions=frozenset(),
        outlet_ids=frozenset({1}),
        correlation_id="c",
    )

    class S:
        codegen_sql_plan_enabled = False

    monkeypatch.setattr("app.query_modes.codegen.planner.get_settings", lambda: S())

    state = {
        "auth": auth,
        "normalized_question": "cao điểm bán hàng quý 3 năm 2025",
        "intent": "revenue",
        "time_range": {"from_date": "2025-07-01", "to_date": "2025-09-30"},
        "resolved_entities": {},
        "learned_sql_writer_scenario_asset": {
            "scenario_key": "sqlwriter:test-peak-hour",
            "intent": "revenue",
            "domain": "sales",
            "task_type": "peak_hour_analysis",
            "metric_ids": ["net_revenue"],
            "report_spec": {
                "analysis_mode": "distribution",
                "group_by": "hour_of_day",
                "time_axis": "hour_of_day",
                "ranking_mode": "top",
                "metric_focus": ["net_revenue"],
            },
            "dataset_candidates": ["cdc.fact_sale", "hack.bad"],
            "tables_used": ["cdc.fact_sale"],
            "sql_plan": {
                "goal_vi": "Tìm giờ cao điểm bán hàng",
                "primary_tables": ["cdc.fact_sale", "hack.bad"],
                "logical_steps_vi": ["Đọc cdc.fact_sale", "Nhóm theo giờ bán hàng"],
            },
        },
    }

    with patch("app.query_modes.codegen.planner.llm_call_json", new_callable=AsyncMock) as m:
        out = await codegen_sql_planner(state)

    m.assert_not_awaited()
    assert out["codegen_candidate_tables"] == ["cdc.fact_sale"]
    assert out["codegen_sql_plan"]["primary_tables"] == ["cdc.fact_sale"]
    assert out["codegen_sql_plan"]["goal_vi"] == "Tìm giờ cao điểm bán hàng"
    assert any(t.get("source") == "learned_sql_writer_scenario" for t in out.get("trace", []))


@pytest.mark.asyncio
async def test_planner_filters_unknown_tables(monkeypatch):
    from app.auth.context import AuthContext

    auth = AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset(),
        permissions=frozenset(),
        outlet_ids=frozenset({1}),
        correlation_id="c",
    )

    class S:
        codegen_sql_plan_enabled = True

    monkeypatch.setattr("app.query_modes.codegen.planner.get_settings", lambda: S())

    fake_parse = {
        "goal_vi": "Test",
        "primary_tables": ["analytics.fct_sales_daily", "hack.bad_table"],
        "optional_tables": ["cdc.outlet"],
        "grain_vi": "ngày",
        "time_binding_vi": "business_date",
        "metric_plan_vi": [],
        "join_hints_vi": [],
        "filter_hints_vi": [],
        "risk_notes_vi": [],
        "must_avoid_vi": [],
        "logical_steps_vi": ["Bước 1", "Bước 2"],
    }

    with patch("app.query_modes.codegen.planner.llm_call_json", new_callable=AsyncMock) as m:
        m.return_value = (fake_parse, {"tokens_in": 1, "tokens_out": 1, "latency_ms": 1})
        state = {
            "auth": auth,
            "normalized_question": "test",
            "intent": "revenue",
            "time_range": {},
            "resolved_entities": {},
        }
        out = await codegen_sql_planner(state)

    plan = out.get("codegen_sql_plan") or {}
    assert "analytics.fct_sales_daily" in plan.get("primary_tables", [])
    assert not any("hack" in x for x in plan.get("primary_tables", []))


@pytest.mark.asyncio
async def test_planner_uses_semantic_candidate_pack_instead_of_full_allowlist(monkeypatch):
    from app.auth.context import AuthContext

    auth = AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset({"finance"}),
        permissions=frozenset(),
        outlet_ids=frozenset({1}),
        correlation_id="c",
    )

    class S:
        codegen_sql_plan_enabled = True

    monkeypatch.setattr("app.query_modes.codegen.planner.get_settings", lambda: S())

    fake_parse = {
        "goal_vi": "Test",
        "primary_tables": ["analytics.ai_sales_daily", "fern.events_expense_created"],
        "optional_tables": ["cdc.outlet"],
        "grain_vi": "ngày",
        "time_binding_vi": "business_date",
        "metric_plan_vi": [],
        "join_hints_vi": [],
        "filter_hints_vi": [],
        "risk_notes_vi": [],
        "must_avoid_vi": [],
        "logical_steps_vi": ["Bước 1", "Bước 2"],
    }

    captured = {}

    async def fake_llm_call_json(**kwargs):
        captured["user_prompt"] = kwargs["user_prompt"]
        return fake_parse, {"tokens_in": 1, "tokens_out": 1, "latency_ms": 1}

    with patch("app.query_modes.codegen.planner.llm_call_json", side_effect=fake_llm_call_json):
        out = await codegen_sql_planner(
            {
                "auth": auth,
                "normalized_question": "doanh thu tháng này theo cửa hàng",
                "intent": "revenue",
                "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
                "resolved_entities": {},
            }
        )

    prompt = captured["user_prompt"]
    assert "analytics.ai_sales_daily" in prompt
    assert "cdc.outlet" in prompt
    assert "fern.events_expense_created" not in prompt
    plan = out.get("codegen_sql_plan") or {}
    assert plan["primary_tables"] == ["analytics.ai_sales_daily"]
    assert out["codegen_candidate_tables"]
