from scripts.promote_learning_scenarios import promote


def test_promote_sql_writer_candidate_as_runtime_blueprint():
    rows = [
        {
            "sql_writer_candidate": {
                "candidate_type": "sql_writer_codegen",
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
                    "ranking_mode": "top",
                    "metric_focus": ["net_revenue"],
                },
                "dataset_candidates": ["cdc.fact_sale", "analytics.ai_sales_daily"],
                "tables_used": ["cdc.fact_sale"],
                "sql_hash": "hash-a",
                "sql_plan": {
                    "goal_vi": "Tìm cao điểm bán hàng",
                    "primary_tables": ["cdc.fact_sale"],
                    "logical_steps_vi": ["Đọc giao dịch", "Nhóm theo giờ"],
                },
                "trial_passed": True,
                "example_questions": ["cao điểm bán hàng quý 3 năm 2025"],
                "permission_profile": {"include_fallback_tables": True, "max_tables": 8},
            }
        },
        {
            "sql_writer_candidate": {
                "candidate_type": "sql_writer_codegen",
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
                    "ranking_mode": "top",
                    "metric_focus": ["net_revenue"],
                },
                "dataset_candidates": ["cdc.fact_sale", "analytics.ai_sales_daily"],
                "tables_used": ["cdc.fact_sale"],
                "sql_hash": "hash-b",
                "sql_plan": {
                    "goal_vi": "Tìm cao điểm bán hàng",
                    "primary_tables": ["cdc.fact_sale"],
                    "logical_steps_vi": ["Đọc giao dịch", "Nhóm theo giờ"],
                },
                "trial_passed": True,
                "example_questions": ["giờ nào bán hàng nhiều nhất quý 3 năm 2025"],
                "permission_profile": {"include_fallback_tables": True, "max_tables": 8},
            }
        },
    ]

    promoted = promote(rows, min_occurrences=2, existing={"version": 1, "scenarios": []})

    scenarios = promoted["scenarios"]
    assert len(scenarios) == 1
    item = scenarios[0]
    assert item["scenario_type"] == "sql_writer"
    assert item["template_key"] is None
    assert item["scenario_key"] == "sqlwriter:test-peak-hour"
    assert item["requires_codegen_trial"] is True
    assert item["promotion_policy"] == "runtime_blueprint_only_no_raw_sql"
    assert item["sql_hashes"] == ["hash-a", "hash-b"]
    assert item["sql_plan"]["primary_tables"] == ["cdc.fact_sale"]
    assert item["example_questions"] == [
        "cao điểm bán hàng quý 3 năm 2025",
        "giờ nào bán hàng nhiều nhất quý 3 năm 2025",
    ]
