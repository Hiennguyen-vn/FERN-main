"""Sanity tests for the eval harness (no real OpenAI/ClickHouse calls)."""

from __future__ import annotations

import json

import pytest

from app.evals.golden_cases import GOLDEN_CASES, GoldenCase
from app.evals.runner import grade_case, report_to_jsonl, run_eval_suite
from scripts.run_openai_evals import _route_intent_only_invoker


def _state(**overrides):
    base = {
        "agent_route": "data_query",
        "intent": "revenue",
        "template_key": "T01_daily_revenue",
        "codegen_tables_used": ["analytics.ai_sales_daily"],
        "final_sql": "SELECT 1",
        "raw_result": [{"x": 1}],
        "execution_error": None,
        "trace": [{"node": "supervisor_agent", "tokens_in": 100, "tokens_out": 50, "tokens_cached": 80}],
    }
    base.update(overrides)
    return base


def test_grade_case_all_axes_pass():
    case = GoldenCase(
        id="x",
        question="q",
        auth_roles=("finance",),
        auth_outlet_ids=(1,),
        expected_route="data_query",
        expected_intent="revenue",
        expected_template_key="T01_daily_revenue",
        expected_tables_subset=("analytics.ai_sales_daily",),
        expects_sql=True,
    )
    result = grade_case(case, _state(), duration_ms=42)
    assert result.passed
    assert all(result.axes.values())
    assert result.tokens["in"] == 100
    assert result.tokens["cached"] == 80
    assert result.duration_ms == 42


def test_grade_case_mismatched_route_fails():
    case = GoldenCase(
        id="x",
        question="q",
        auth_roles=("finance",),
        auth_outlet_ids=(1,),
        expected_route="data_query",
        expected_intent="revenue",
    )
    result = grade_case(case, _state(agent_route="hr_staff"), duration_ms=10)
    assert not result.passed
    assert result.axes["route"] is False


def test_grade_case_tables_subset_fails_when_extra_table_used():
    case = GoldenCase(
        id="x",
        question="q",
        auth_roles=("finance",),
        auth_outlet_ids=(1,),
        expected_route="data_query",
        expected_intent="revenue",
        expected_tables_subset=("analytics.ai_sales_daily",),
    )
    # Actual SQL only touched a different table — subset must fail.
    result = grade_case(
        case,
        _state(codegen_tables_used=["fern.events_invoice_approved"]),
        duration_ms=10,
    )
    assert not result.passed
    assert result.axes["tables_subset"] is False


def test_grade_case_negative_sql_presence():
    """Cases like the RBAC negative test expect NO SQL to be generated."""
    case = GoldenCase(
        id="x",
        question="q",
        auth_roles=("outlet_manager",),
        auth_outlet_ids=(1,),
        expected_route="data_query",
        expected_intent="pnl",
        expects_sql=False,
    )
    state = _state(
        final_sql=None,
        raw_result=None,
        codegen_tables_used=[],
        intent="pnl",
        template_key=None,
    )
    result = grade_case(case, state, duration_ms=5)
    assert result.passed
    assert result.axes["sql_presence"] is True
    assert "no_execute_error" not in result.axes  # axis only graded when expects_sql


def test_grade_case_codegen_requires_sql_writer_path():
    case = GoldenCase(
        id="SAL-070",
        question="q",
        auth_roles=("outlet_manager",),
        auth_outlet_ids=(1,),
        expected_route="data_query",
        expected_tables_subset=("analytics.ai_sales_daily",),
        expects_sql=True,
        tags=("codegen", "L4"),
    )

    result = grade_case(
        case,
        _state(
            template_key="T02_revenue_by_outlet",
            executed_sql_source="template",
            codegen_tables_used=[],
        ),
        duration_ms=5,
    )

    assert not result.passed
    assert result.axes["codegen_path"] is False


def test_grade_case_codegen_path_passes_with_sql_writer():
    case = GoldenCase(
        id="SAL-070",
        question="q",
        auth_roles=("outlet_manager",),
        auth_outlet_ids=(1,),
        expected_route="data_query",
        expected_tables_subset=("analytics.ai_sales_daily",),
        expects_sql=True,
        tags=("codegen", "L4"),
    )

    result = grade_case(
        case,
        _state(
            template_key=None,
            executed_sql_source="codegen",
            codegen_tables_used=["analytics.ai_sales_daily"],
        ),
        duration_ms=5,
    )

    assert result.passed
    assert result.axes["codegen_path"] is True


@pytest.mark.asyncio
async def test_run_eval_suite_aggregates_axes():
    cases = [
        GoldenCase(
            id="a",
            question="q1",
            auth_roles=("finance",),
            auth_outlet_ids=(1,),
            expected_route="data_query",
            expected_intent="revenue",
        ),
        GoldenCase(
            id="b",
            question="q2",
            auth_roles=("finance",),
            auth_outlet_ids=(1,),
            expected_route="data_query",
            expected_intent="revenue",
        ),
    ]

    async def invoker(case):
        if case.id == "a":
            return _state()
        return _state(agent_route="hr_staff")

    report = await run_eval_suite(cases, invoke_agent=invoker)
    assert report["summary"]["total"] == 2
    assert report["summary"]["passed"] == 1
    assert report["summary"]["pass_rate"] == 0.5
    assert report["summary"]["axis_pass_rates"]["route"] == 0.5


def test_report_to_jsonl_is_one_summary_plus_results():
    report = {
        "summary": {"total": 1, "passed": 1, "pass_rate": 1.0, "axis_pass_rates": {}, "p50_latency_ms": 1, "p95_latency_ms": 1},
        "results": [
            {
                "case_id": "x",
                "passed": True,
                "axes": {"route": True},
                "actual": {},
                "expected": {},
                "diagnostics": {},
                "duration_ms": 1,
                "tokens": {"in": 1, "out": 1, "cached": 0},
            }
        ],
    }
    jsonl = report_to_jsonl(report)
    lines = [ln for ln in jsonl.splitlines() if ln.strip()]
    assert len(lines) == 2
    summary = json.loads(lines[0])
    assert summary.get("type") == "summary"
    item = json.loads(lines[1])
    assert item["item"]["id"] == "x"
    assert item["passed"] is True


def test_golden_cases_have_unique_ids():
    ids = [c.id for c in GOLDEN_CASES]
    assert len(set(ids)) == len(ids)
    # Sanity floor: at least one social, one verified-template, one negative.
    tags_seen = {tag for c in GOLDEN_CASES for tag in c.tags}
    assert "social" in tags_seen
    assert "verified-query" in tags_seen
    assert "rbac" in tags_seen


@pytest.mark.asyncio
async def test_local_eval_invoker_runs_hr_lane_template_selection():
    case = GoldenCase(
        id="HR-001",
        question="cửa hàng tôi có bao nhiêu nhân viên",
        auth_roles=("outlet_manager",),
        auth_outlet_ids=(1,),
        expected_route="hr_staff",
        expected_intent="hr_staff",
        expected_template_key="HR_staff_list",
        expects_sql=False,
    )

    state = await _route_intent_only_invoker(case)

    assert state["agent_route"] == "hr_staff"
    assert state["intent"] == "hr_staff"
    assert state["template_key"] == "HR_staff_list"
    assert not state.get("final_sql")
