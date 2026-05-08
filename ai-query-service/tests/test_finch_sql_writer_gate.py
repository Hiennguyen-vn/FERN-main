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
