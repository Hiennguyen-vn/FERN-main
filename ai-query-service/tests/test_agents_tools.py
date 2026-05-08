"""Unit tests for the deterministic agent tools (search/policy/validate)."""

from __future__ import annotations

import pytest

from app.agents.tools import (
    ValidateContext,
    _get_table_policy,
    _list_columns,
    _search_schema,
    make_validate_and_inject_tool,
)


def test_search_schema_returns_curated_tables_for_revenue():
    out = _search_schema("doanh thu hằng ngày", intent="revenue", max_tables=6)
    table_names = {t["name"] for t in out["tables"]}
    assert "analytics.ai_sales_daily" in table_names
    # Lookup-only tables can appear (cdc.outlet) but must be flagged
    for t in out["tables"]:
        assert "outlet_column" in t
        assert "time_column" in t


def test_get_table_policy_known_table():
    out = _get_table_policy("analytics.ai_sales_daily")
    assert out["ok"] is True
    assert out["allow_listed"] is True
    assert out["outlet_column"]
    assert out["time_column"]


def test_get_table_policy_exposes_sale_line_price_and_discount():
    out = _get_table_policy("cdc.fact_sale")

    assert out["ok"] is True
    assert {"unit_price", "discount_amount", "line_total"}.issubset(set(out["metrics"]))
    assert "price band" in out["description_vi"]


def test_list_columns_falls_back_to_catalog_snapshot(monkeypatch):
    from app.clients import clickhouse as ch_mod

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("no clickhouse in shadow")

    monkeypatch.setattr(ch_mod, "execute_query", unavailable, raising=True)

    out = _list_columns("cdc.fact_sale")

    assert out["ok"] is True
    assert out["source"] == "catalog_snapshot"
    names = {col["name"] for col in out["columns"]}
    assert {"unit_price", "discount_amount", "line_total"}.issubset(names)


def test_get_table_policy_unknown_table():
    out = _get_table_policy("not.real_table")
    assert out["ok"] is False
    assert out["allow_listed"] is False


def test_validate_and_inject_rejects_unknown_table(monkeypatch):
    # Skip the EXPLAIN PIPELINE path that would hit ClickHouse.
    import app.agents.tools as tools_mod

    def fake_explain_syntax(_sql):
        return True, ""

    def fake_explain_pipeline(_sql, **_kwargs):
        return True, ""

    monkeypatch.setattr(
        tools_mod, "explain_syntax", fake_explain_syntax, raising=False
    )
    monkeypatch.setattr(
        tools_mod, "explain_pipeline", fake_explain_pipeline, raising=False
    )
    # Patch the lazy-imported clickhouse symbols too
    import sys

    sys.modules.setdefault("app.clients.clickhouse", sys.modules.get("app.clients.clickhouse"))

    ctx = ValidateContext(
        auth_outlet_ids=frozenset({1, 2}),
        auth_roles=frozenset({"outlet_manager"}),
        candidate_tables=frozenset({"analytics.ai_sales_daily", "cdc.outlet"}),
        requested_outlet_ids=[],
        all_outlet_ids_provider=None,
    )
    tool = make_validate_and_inject_tool(ctx)
    out = tool.execute(
        sql="SELECT * FROM analytics.fct_inventory_snapshot WHERE business_date = today()"
    )
    assert out["ok"] is False
    # Either "Tables outside candidate pack" or a structural violation triggers
    assert any("candidate pack" in e or "candidate" in e for e in out["errors"]) or out["errors"]


def test_validate_and_inject_injects_outlet_filter(monkeypatch):
    import app.agents.tools as tools_mod
    from app.clients import clickhouse as ch_mod

    monkeypatch.setattr(
        ch_mod,
        "explain_syntax",
        lambda *_a, **_k: (True, ""),
        raising=True,
    )
    monkeypatch.setattr(
        ch_mod,
        "explain_pipeline",
        lambda *_a, **_k: (True, ""),
        raising=True,
    )

    ctx = ValidateContext(
        auth_outlet_ids=frozenset({1, 2, 3}),
        auth_roles=frozenset({"outlet_manager"}),
        candidate_tables=frozenset({"analytics.ai_sales_daily"}),
        requested_outlet_ids=[],
        all_outlet_ids_provider=None,
    )
    tool = make_validate_and_inject_tool(ctx)
    sql = (
        "SELECT business_date, sum(net_revenue) AS revenue "
        "FROM analytics.ai_sales_daily "
        "WHERE business_date BETWEEN toDate('2026-05-01') AND toDate('2026-05-07') "
        "GROUP BY business_date"
    )
    out = tool.execute(sql=sql)
    assert out["ok"] is True, out["errors"]
    assert "outlet_id IN" in out["final_sql"].replace(" ", "")[: len(out["final_sql"])] or "outlet_id" in out["final_sql"].lower()
    assert out["allowed_outlet_ids"] == [1, 2, 3]
    assert "analytics.ai_sales_daily" in out["tables_used"]
