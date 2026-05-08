from __future__ import annotations

import yaml

from app.query_policy.learned_scenarios import (
    build_scenario_candidate_from_state,
    clear_learned_scenarios_cache,
    select_learned_scenario,
    select_sql_writer_scenario,
)


def test_build_scenario_candidate_from_state_uses_report_spec_and_permission_profile():
    state = {
        "normalized_question": "doanh thu chia theo hình thức thu tiền tháng này",
        "intent": "revenue",
        "template_key": "T08_revenue_by_payment_method",
        "template_confidence": 0.91,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "planning_frame": {
            "domain": "payment",
            "task_type": "metric_summary",
            "metric_ids": ["net_revenue"],
        },
        "planning_decision": {
            "selected_metric_ids": ["net_revenue"],
            "selected_dataset_candidates": ["analytics.ai_payment_daily", "cdc.payment"],
            "required_slots": ["from_date", "to_date"],
            "report_spec": {
                "analysis_mode": "breakdown",
                "group_by": "payment_method",
                "time_axis": None,
                "comparison_mode": None,
                "ranking_mode": "top",
                "metric_focus": ["net_revenue"],
            },
        },
    }

    out = build_scenario_candidate_from_state(state)

    assert out is not None
    assert out["scenario_key"].startswith("scenario:")
    assert out["template_key"] == "T08_revenue_by_payment_method"
    assert out["domain"] == "payment"
    assert out["report_spec"]["group_by"] == "payment_method"
    assert out["permission_profile"] == {"include_fallback_tables": True, "max_tables": 6}


def test_select_learned_scenario_matches_promoted_yaml_asset(tmp_path, monkeypatch):
    path = tmp_path / "learned_scenarios.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "scenarios": [
                    {
                        "scenario_key": "scenario:test-payment",
                        "template_key": "T08_revenue_by_payment_method",
                        "intent": "revenue",
                        "domain": "payment",
                        "task_type": "metric_summary",
                        "metric_ids": ["net_revenue"],
                        "required_slots": ["from_date", "to_date"],
                        "report_spec": {
                            "analysis_mode": "breakdown",
                            "group_by": "payment_method",
                            "time_axis": None,
                            "comparison_mode": None,
                            "ranking_mode": "top",
                            "metric_focus": ["net_revenue"],
                        },
                        "dataset_candidates": ["analytics.ai_payment_daily", "cdc.payment"],
                        "example_questions": ["doanh thu chia theo hình thức thu tiền tháng này"],
                        "permission_profile": {"include_fallback_tables": True, "max_tables": 8},
                        "min_confidence": 0.75,
                        "enabled": True,
                    }
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr("app.query_policy.learned_scenarios.SCENARIO_KNOWLEDGE_PATH", path)
    clear_learned_scenarios_cache()

    match = select_learned_scenario(
        question="doanh thu chia theo hình thức thu tiền tháng này",
        intent="revenue",
        time_range={"from_date": "2026-05-01", "to_date": "2026-05-04"},
        planning_frame={"domain": "payment", "task_type": "metric_summary", "metric_ids": ["net_revenue"]},
        planning_decision={
            "selected_metric_ids": ["net_revenue"],
            "report_spec": {
                "analysis_mode": "breakdown",
                "group_by": "payment_method",
                "time_axis": None,
                "comparison_mode": None,
                "ranking_mode": "top",
                "metric_focus": ["net_revenue"],
            },
        },
        min_score=0.75,
    )

    assert match is not None
    assert match.template_key == "T08_revenue_by_payment_method"
    assert match.params == {"from_date": "2026-05-01", "to_date": "2026-05-04"}
    assert match.asset.scenario_key == "scenario:test-payment"


def test_select_sql_writer_scenario_matches_promoted_blueprint(tmp_path, monkeypatch):
    path = tmp_path / "learned_scenarios.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "scenarios": [
                    {
                        "scenario_type": "sql_writer",
                        "scenario_key": "sqlwriter:test-peak-hour",
                        "intent": "revenue",
                        "domain": "sales",
                        "task_type": "peak_hour_analysis",
                        "metric_ids": ["net_revenue"],
                        "required_slots": ["from_date", "to_date"],
                        "report_spec": {
                            "analysis_mode": "distribution",
                            "group_by": "hour_of_day",
                            "time_axis": "hour_of_day",
                            "comparison_mode": None,
                            "ranking_mode": "top",
                            "metric_focus": ["net_revenue"],
                        },
                        "dataset_candidates": ["analytics.fct_sales_daily", "cdc.fact_sale"],
                        "tables_used": ["cdc.fact_sale"],
                        "sql_hashes": ["abc123"],
                        "sql_plan": {
                            "goal_vi": "Tìm giờ cao điểm bán hàng",
                            "primary_tables": ["cdc.fact_sale"],
                            "logical_steps_vi": ["Đọc giao dịch bán hàng", "Nhóm theo giờ"],
                        },
                        "example_questions": ["cao điểm bán hàng quý 3 năm 2025"],
                        "permission_profile": {"include_fallback_tables": True, "max_tables": 8},
                        "min_confidence": 0.74,
                        "enabled": True,
                    }
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr("app.query_policy.learned_scenarios.SCENARIO_KNOWLEDGE_PATH", path)
    clear_learned_scenarios_cache()

    match = select_sql_writer_scenario(
        question="cao điểm bán hàng quý 3 năm 2025",
        intent="revenue",
        time_range={"from_date": "2025-07-01", "to_date": "2025-09-30"},
        planning_frame={"domain": "sales", "task_type": "peak_hour_analysis", "metric_ids": ["net_revenue"]},
        planning_decision={
            "selected_metric_ids": ["net_revenue"],
            "report_spec": {
                "analysis_mode": "distribution",
                "group_by": "hour_of_day",
                "time_axis": "hour_of_day",
                "comparison_mode": None,
                "ranking_mode": "top",
                "metric_focus": ["net_revenue"],
            },
        },
        min_score=0.74,
    )

    assert match is not None
    assert match.asset.scenario_key == "sqlwriter:test-peak-hour"
    assert "cdc.fact_sale" in match.asset.dataset_candidates
