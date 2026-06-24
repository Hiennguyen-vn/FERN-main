"""Finch graph SQL writer preconditions (slot gate before codegen)."""

from __future__ import annotations

from app.query_modes.codegen.routing import sql_writer_preconditions_ok


def test_sql_writer_preconditions_ok_false_on_planner_clarification():
    state = {
        "agent_route": "data_query",
        "intent": "revenue",
        "needs_sql_writer": True,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-07"},
        "planning_frame": {"next_action": "ask_clarification", "ambiguities": ["time_range"]},
        "matcher_missing_info": [],
        "response_hints": [],
        "ambiguities": [],
    }
    assert sql_writer_preconditions_ok(state) is False


def test_sql_writer_preconditions_ok_false_on_missing_time_for_non_inventory():
    state = {
        "agent_route": "data_query",
        "intent": "revenue",
        "needs_sql_writer": True,
        "time_range": {},
        "planning_frame": {"next_action": "template_match", "ambiguities": [], "task_type": "metric_summary"},
        "matcher_missing_info": [],
        "response_hints": [],
        "ambiguities": [],
    }
    assert sql_writer_preconditions_ok(state) is False


def test_sql_writer_preconditions_ok_true_when_ready():
    state = {
        "agent_route": "data_query",
        "intent": "revenue",
        "needs_sql_writer": True,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-07"},
        "planning_frame": {"next_action": "template_match", "ambiguities": [], "task_type": "metric_summary"},
        "matcher_missing_info": [],
        "response_hints": [],
        "ambiguities": [],
    }
    assert sql_writer_preconditions_ok(state) is True


def test_route_after_coverage_blocks_sql_writer_when_gate_fails():
    from app.agents.graph_builder import _route_after_coverage

    state = {
        "agent_route": "data_query",
        "intent": "revenue",
        "needs_sql_writer": True,
        "template_key": None,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-07"},
        "planning_frame": {"next_action": "ask_clarification", "ambiguities": ["time_range"]},
        "matcher_missing_info": [],
        "response_hints": [],
        "ambiguities": [],
        "trace": [],
    }
    assert _route_after_coverage(state) == "answer_formatter"
    assert state["needs_sql_writer"] is False
    assert state["response_kind"] == "clarification"
    assert state["clarification_question"]


def test_route_after_coverage_disables_template_response(monkeypatch):
    from types import SimpleNamespace

    from app.agents import graph_builder

    monkeypatch.setattr(
        graph_builder,
        "get_settings",
        lambda: SimpleNamespace(template_response_enabled=False),
    )

    state = {
        "agent_route": "data_query",
        "intent": "revenue",
        "template_key": "T32_period_revenue_summary",
        "template_params": {"from_date": "2026-05-01", "to_date": "2026-05-19"},
        "needs_sql_writer": False,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-19"},
        "planning_frame": {"next_action": "template_match", "ambiguities": [], "task_type": "metric_summary"},
        "sql_writer_contract": {
            "comparison_periods": {
                "period_a": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
                "period_b": {"from_date": "2026-03-01", "to_date": "2026-03-31"},
            },
            "time_range": {"from_date": "2026-03-01", "to_date": "2026-03-31"},
        },
        "matcher_missing_info": [],
        "response_hints": [],
        "ambiguities": [],
        "trace": [],
    }

    assert graph_builder._route_after_coverage(state) == "sql_writer_agent"
    assert state["template_key"] is None
    assert state["template_params"] == {}
    assert state["needs_sql_writer"] is True
    assert state["time_range"] == {"from_date": "2026-03-01", "to_date": "2026-04-30"}
    assert state["sql_writer_contract"]["time_range"] == {"from_date": "2026-03-01", "to_date": "2026-04-30"}
    assert state["trace"][-1]["template_response_disabled"] is True


def test_finch_graph_routes_unsupported_directly_to_formatter():
    from app.agents.graph_builder import _route_after_coverage, _route_after_supervisor

    state = {
        "agent_route": "data_query",
        "intent": "unknown",
        "response_kind": "unsupported",
        "needs_sql_writer": False,
        "template_key": None,
    }

    assert _route_after_supervisor(state) == "answer_formatter"
    assert _route_after_coverage(state) == "answer_formatter"
