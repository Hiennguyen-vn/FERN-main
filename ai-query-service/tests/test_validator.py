from app.auth.context import AuthContext
from app.graph.nodes.validator import MAX_DATE_RANGE_DAYS, validator


def _auth() -> AuthContext:
    return AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset({"admin"}),
        permissions=frozenset(),
        outlet_ids=frozenset({1}),
    )


def test_validator_allows_up_to_seven_year_window():
    state = {
        "auth": _auth(),
        "template_key": "T32_period_revenue_summary",
        "template_params": {"from_date": "2019-05-07", "to_date": "2026-05-06"},
    }

    out = validator(state)

    assert MAX_DATE_RANGE_DAYS == 2557
    assert out["validation_errors"] == []


def test_validator_rejects_over_seven_year_window():
    state = {
        "auth": _auth(),
        "template_key": "T32_period_revenue_summary",
        "template_params": {"from_date": "2019-05-05", "to_date": "2026-05-06"},
    }

    out = validator(state)

    assert out["validation_errors"] == ["Date range > 2557 days"]


def test_validator_syncs_template_dates_to_final_time_range():
    state = {
        "auth": _auth(),
        "template_key": "T23_peak_hour_analysis",
        "time_range": {"from_date": "2025-07-02", "to_date": "2025-09-30"},
        "template_params": {"from_date": "2025-07-01", "to_date": "2025-09-30"},
    }

    out = validator(state)

    assert out["validation_errors"] == []
    assert out["template_params"] == {"from_date": "2025-07-02", "to_date": "2025-09-30"}
