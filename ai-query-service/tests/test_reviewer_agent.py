from types import SimpleNamespace

from app.agents import reviewer_agent as reviewer


def test_reviewer_safe_facts_include_scope_and_hr_detail_columns(monkeypatch):
    monkeypatch.setattr(
        reviewer,
        "get_settings",
        lambda: SimpleNamespace(reviewer_answer_facts_max_rows=5),
    )

    state = {
        "template_key": "HR_staff_list",
        "intent": "hr_staff",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-02"},
        "allowed_outlet_ids": [3485604078895513600],
        "data_source_context": {
            "coverage_status": "full",
            "primary_dataset": "core.work_shift",
            "requested_range": {"from_date": "2026-05-01", "to_date": "2026-05-02"},
            "available_range": {"min_date": "2025-07-02", "max_date": "2026-05-02"},
            "actual_data_range": {"from_date": "2026-05-01", "to_date": "2026-05-02"},
            "caveats": [],
        },
        "raw_result": [
            {
                "user_id": 1,
                "full_name": "A",
                "username": "a",
                "employee_code": "E1",
                "status": "active",
                "outlet_id": 3485604078895513600,
                "outlet_code": "SIM-SMALL-OUT-0006",
                "outlet_name": "Outlet VN-HCM-6",
                "last_work_date": "2026-05-02",
            }
        ],
    }

    facts = reviewer._safe_facts(state)

    assert facts["scope_facts"]["allowed_outlet_ids"] == [3485604078895513600]
    assert facts["scope_facts"]["time_range"] == {"from_date": "2026-05-01", "to_date": "2026-05-02"}
    assert facts["preview_rows"][0]["last_work_date"] == "2026-05-02"


def test_reviewer_skips_deterministic_insight_templates(monkeypatch):
    monkeypatch.setattr(
        reviewer,
        "get_settings",
        lambda: SimpleNamespace(reviewer_agent_enabled=True),
    )

    skip, reason = reviewer._should_skip(
        {
            "template_key": "FORECAST_STOCK_COVER",
            "response_kind": "answer",
            "answer_text": "Câu trả lời deterministic đã có caveat nghiệp vụ.",
            "raw_result": [{"item_id": 1}],
        }
    )

    assert skip is True
    assert reason == "deterministic_insight"


def test_reviewer_skips_deterministic_lookup_templates(monkeypatch):
    monkeypatch.setattr(
        reviewer,
        "get_settings",
        lambda: SimpleNamespace(reviewer_agent_enabled=True),
    )

    skip, reason = reviewer._should_skip(
        {
            "template_key": "T37_ai_sales_daily_outlets",
            "intent": "lookup",
            "response_kind": "answer",
            "answer_text": "Có 12 cửa hàng có dữ liệu trong analytics.ai_sales_daily.",
            "raw_result": [{"outlet_id": 1}],
        }
    )

    assert skip is True
    assert reason == "deterministic_lookup"
