"""Workflow summary derivation from graph trace/state."""

from app.auth.context import AuthContext
from app.graph.workflow_summary import (
    build_workflow_steps,
    build_workflow_summary,
    compact_trace_for_client,
    workflow_node_sequence,
)


def test_node_sequence_collapses_consecutive_duplicates():
    trace = [
        {"node": "a", "x": 1},
        {"node": "a"},
        {"node": "b"},
        {"node": "b"},
        {"node": "c"},
    ]
    assert workflow_node_sequence(trace) == ["a", "b", "c"]


def test_compact_trace_whitelist_and_truncates_tail():
    long_tail = [{"node": f"n{i}", "secret": "hide-me"} for i in range(60)]
    out = compact_trace_for_client(long_tail, max_entries=48)
    assert len(out) == 48
    assert out[0]["node"] == "n12"
    assert all("secret" not in e for e in out)


def test_build_workflow_summary_template_success():
    auth = AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset(),
        permissions=frozenset(),
        outlet_ids=frozenset({1}),
        correlation_id="c",
    )
    state = {
        "auth": auth,
        "intent": "revenue",
        "trace": [
            {"node": "preprocess"},
            {"node": "template_matcher"},
            {"node": "validator"},
            {"node": "executor"},
            {"node": "answer_formatter", "latency_ms": 10},
        ],
        "response_kind": "answer",
        "template_key": "T02_revenue_by_outlet",
        "executed_sql_source": "template",
        "guard_passed": True,
        "correction_attempts": 0,
        "raw_result": [{"x": 1}],
    }
    s = build_workflow_summary(state, graph_cpu_ms=42)
    assert s["lane"] == "analytics"
    assert s["sql_execution_source"] == "template"
    assert s["graph_cpu_ms"] == 42
    assert "executor" in s["node_sequence"]
    assert s["graph_outcome"] == "success"


def test_build_workflow_summary_codegen_flags():
    auth = AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset(),
        permissions=frozenset(),
        outlet_ids=frozenset({1}),
        correlation_id="c",
    )
    state = {
        "auth": auth,
        "intent": "revenue",
        "trace": [
            {"node": "codegen_sql_planner", "skipped": True},
            {"node": "codegen_generator"},
        ],
        "codegen_exhausted": False,
        "codegen_trial_passed": True,
        "codegen_review_approve": True,
        "executed_sql_source": "codegen",
        "guard_passed": True,
        "raw_result": [],
    }
    s = build_workflow_summary(state)
    assert "codegen" in s
    assert s["codegen"]["planner_skipped"] is True
    assert s["codegen"]["trial_passed"] is True


def test_build_workflow_summary_contextualized_flag():
    state = {
        "intent": "hr_staff",
        "trace": [{"node": "contextualizer", "outcome": "rewritten", "reason": "rule_time_followup"}],
        "contextualized_question": "nhân viên nào đi làm nhiều nhất tuần này",
        "contextualization_source": "rule_time_followup",
        "raw_result": [],
    }

    s = build_workflow_summary(state)

    assert s["lane"] == "hr"
    assert s["contextualized"] == {"applied": True, "source": "rule_time_followup"}


def test_build_workflow_summary_exposes_safe_question_frame_and_verified_asset():
    state = {
        "intent": "outlet_compare",
        "trace": [{"node": "template_matcher", "source": "verified_query", "verified_asset": "T22_outlet_rank"}],
        "template_key": "T22_outlet_rank",
        "verified_query_asset": {
            "template_key": "T22_outlet_rank",
            "metric_ids": ["net_revenue"],
            "golden_cases": ["top_outlet_revenue_current_period"],
        },
        "question_frame": {
            "intent": "outlet_compare",
            "time_source": "followup_current_turn",
            "followup_source": "rule_time_followup",
            "is_time_followup": True,
            "effective_question": "doanh thu tháng trước theo cửa hàng",
        },
        "raw_result": [],
    }

    s = build_workflow_summary(state)

    assert s["lane_detail"] == "deterministic_template"
    assert s["question_frame"] == {
        "intent": "outlet_compare",
        "time_source": "followup_current_turn",
        "followup_source": "rule_time_followup",
        "is_time_followup": True,
    }
    assert s["verified_query"] == {
        "template_key": "T22_outlet_rank",
        "metric_ids": ["net_revenue"],
        "time_column": None,
        "outlet_column": None,
        "golden_cases": ["top_outlet_revenue_current_period"],
    }
    assert "effective_question" not in s["question_frame"]


def test_build_workflow_summary_exposes_safe_planning_frame():
    state = {
        "intent": "revenue",
        "trace": [{"node": "supervisor", "router_layer": "rule", "next_action": "ask_clarification", "confidence": 0.86}],
        "planning_frame": {
            "route": "data_query",
            "intent": "revenue",
            "domain": "sales",
            "task_type": "metric_summary",
            "metric_ids": ["net_revenue"],
            "grain": "period",
            "time_source": "effective_question",
            "next_action": "ask_clarification",
            "confidence": 0.86,
            "ambiguities": ["time_range"],
            "evidence": ["rule", "time:effective_question"],
            "entities": {"outlet_names": []},
        },
        "planning_decision": {
            "selected_domain": "sales",
            "selected_metric_ids": ["net_revenue"],
            "selected_dataset_candidates": ["analytics.ai_sales_daily"],
            "missing_slots": ["time_range"],
            "recommended_template_keys": [],
            "report_spec": {
                "analysis_mode": "summary",
                "group_by": None,
                "time_axis": None,
                "comparison_mode": None,
                "ranking_mode": None,
                "metric_focus": ["net_revenue"],
            },
            "reject_reason_vi": "Thiếu time_range",
        },
    }

    s = build_workflow_summary(state)

    assert s["planning_frame"] == {
        "route": "data_query",
        "intent": "revenue",
        "domain": "sales",
        "task_type": "metric_summary",
        "metric_ids": ["net_revenue"],
        "time_source": "effective_question",
        "next_action": "ask_clarification",
        "ambiguity_count": 1,
    }
    assert s["route_confidence"] == 0.86
    assert s["clarification_reason"] == "time_range"
    assert "entities" not in s["planning_frame"]
    assert s["planning_decision"]["report_spec"] == {
        "analysis_mode": "summary",
        "group_by": None,
        "time_axis": None,
        "comparison_mode": None,
        "ranking_mode": None,
        "metric_focus": ["net_revenue"],
    }


def test_build_workflow_summary_exposes_learned_scenario():
    state = {
        "intent": "revenue",
        "trace": [{"node": "template_matcher", "source": "learned_scenario", "scenario_key": "scenario:test-payment"}],
        "template_key": "T08_revenue_by_payment_method",
        "learned_scenario_asset": {
            "scenario_key": "scenario:test-payment",
            "template_key": "T08_revenue_by_payment_method",
            "intent": "revenue",
            "domain": "payment",
            "task_type": "metric_summary",
            "metric_ids": ["net_revenue"],
            "required_slots": ["from_date", "to_date"],
        },
    }

    s = build_workflow_summary(state)

    assert s["lane_detail"] == "learned_scenario"
    assert s["learned_scenario"] == {
        "scenario_key": "scenario:test-payment",
        "template_key": "T08_revenue_by_payment_method",
        "intent": "revenue",
        "domain": "payment",
        "task_type": "metric_summary",
        "metric_ids": ["net_revenue"],
        "required_slots": ["from_date", "to_date"],
    }


def test_build_workflow_summary_exposes_explicit_escalation():
    state = {
        "intent": "revenue",
        "response_kind": "clarification",
        "trace": [{"node": "supervisor", "outcome": "escalation_candidate"}],
        "escalation_candidate": True,
        "escalation_reason": "still_missing_slots_after_followup",
    }

    s = build_workflow_summary(state)

    assert s["escalation_candidate"] is True
    assert s["escalation_reason"] == "still_missing_slots_after_followup"


def test_build_workflow_summary_derives_unsupported_analytics_escalation():
    state = {
        "intent": "revenue",
        "response_kind": "unsupported",
        "trace": [{"node": "template_matcher"}],
    }

    s = build_workflow_summary(state)

    assert s["lane"] == "analytics"
    assert s["escalation_candidate"] is True
    assert s["escalation_reason"] == "no_safe_supported_route"


def test_build_workflow_steps_are_user_safe():
    state = {
        "intent": "revenue",
        "trace": [
            {"node": "contextualizer"},
            {"node": "supervisor", "model": "m"},
            {"node": "metadata_context"},
            {"node": "template_matcher"},
            {"node": "rbac_injector"},
            {"node": "sql_guard"},
            {"node": "executor"},
            {"node": "answer_formatter"},
            {"node": "reviewer_agent"},
        ],
    }
    steps = build_workflow_steps(state)
    assert steps[0] == {"key": "analyze", "label": "Phân tích câu hỏi", "status": "done"}
    assert any(s["key"] == "security" and s["status"] == "done" for s in steps)
    assert any(s["key"] == "review" and s["status"] == "done" for s in steps)
    assert "select " not in str(steps).lower()


def test_build_workflow_steps_marks_agent_template_path_done():
    state = {
        "intent": "outlet_compare",
        "template_key": "T22_outlet_rank",
        "trace": [
            {"node": "supervisor_agent"},
            {"node": "data_coverage"},
            {"node": "rbac_injector"},
            {"node": "sql_guard"},
            {"node": "template_path", "stage": "executed", "rows": 9},
            {"node": "answer_formatter", "source": "deterministic_outlet_rank"},
            {"node": "reviewer_agent"},
        ],
    }

    steps = build_workflow_steps(state)

    assert any(s["key"] == "analyze" and s["status"] == "done" for s in steps)
    assert any(s["key"] == "plan" and s["status"] == "done" for s in steps)
    assert any(s["key"] == "execute" and s["status"] == "done" for s in steps)
    assert any(s["key"] == "format" and s["status"] == "done" for s in steps)
