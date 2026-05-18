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
