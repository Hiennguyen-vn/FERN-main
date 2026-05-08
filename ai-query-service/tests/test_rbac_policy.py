"""RBAC post-inject verification for GenSQL."""

from app.codegen.rbac_inject import inject_outlet_filter
from app.codegen.rbac_policy import verify_outlet_in_clause


def test_verify_matches_injected_analytics():
    sql = "SELECT sum(net_revenue) FROM analytics.fct_sales_daily WHERE business_date >= today() - 7"
    injected = inject_outlet_filter(sql, [10, 20])
    ok, msg = verify_outlet_in_clause(injected, [10, 20])
    assert ok, msg


def test_verify_matches_events_camelcase():
    sql = "SELECT 1 FROM fern.events_payment_captured WHERE businessDate >= today()"
    injected = inject_outlet_filter(sql, [3])
    ok, msg = verify_outlet_in_clause(injected, [3])
    assert ok, msg


def test_verify_rejects_wrong_literal_set():
    sql = "SELECT 1 FROM analytics.fct_sales_daily WHERE outlet_id IN (99) AND business_date >= today()"
    ok, msg = verify_outlet_in_clause(sql, [1])
    assert not ok
    assert "no outlet" in msg.lower()
