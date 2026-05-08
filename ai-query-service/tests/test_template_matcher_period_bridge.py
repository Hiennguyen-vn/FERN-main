"""Fast-path routing for period-over-period metrics (T36)."""

from app.graph.nodes import template_matcher as tm


def test_split_month_range_into_two_halves():
    out = tm._split_time_range_for_period_bridge("2026-04-01", "2026-04-30")
    assert out is not None
    assert out["from_date_b"] == "2026-04-01"
    assert out["to_date_b"] == "2026-04-15"
    assert out["from_date_a"] == "2026-04-16"
    assert out["to_date_a"] == "2026-04-30"


def test_split_single_day_compares_previous_calendar_day():
    out = tm._split_time_range_for_period_bridge("2026-05-08", "2026-05-08")
    assert out is not None
    assert out["from_date_a"] == "2026-05-08"
    assert out["to_date_a"] == "2026-05-08"
    assert out["from_date_b"] == "2026-05-07"
    assert out["to_date_b"] == "2026-05-07"


def test_fast_match_aov_and_txn_change_question_uses_t36():
    tr = {"from_date": "2026-04-01", "to_date": "2026-04-30"}
    hit = tm._fast_template_match(
        "AOV và số giao dịch của Outlet VN-HCM-3 thay đổi thế nào?",
        "revenue",
        tr,
    )
    assert hit is not None
    key, params, conf = hit
    assert key == "T36_revenue_period_driver_bridge"
    assert params["from_date_a"] == "2026-04-16"
    assert params["to_date_a"] == "2026-04-30"
    assert params["from_date_b"] == "2026-04-01"
    assert params["to_date_b"] == "2026-04-15"
    assert conf >= 0.9
