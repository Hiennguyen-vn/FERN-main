import pytest

from app.templates.registry import (
    TEMPLATES,
    SQL_DIR,
    list_templates,
    render,
    template_exists,
)
from app.guard.sql_ast import validate_sql


def test_all_templates_have_sql_file():
    missing = [k for k in TEMPLATES if not (SQL_DIR / f"{k}.sql").exists()]
    assert not missing, f"Missing SQL files: {missing}"


def test_forty_six_templates_registered():
    assert len(TEMPLATES) == 46


def test_render_t01():
    sql = render(
        "T01_daily_revenue",
        outlet_ids=[1, 2, 3],
        from_date="2026-01-01",
        to_date="2026-01-31",
    )
    assert "outlet_id IN (1,2,3)" in sql
    assert "2026-01-01" in sql
    assert "2026-01-31" in sql


def test_render_t35_weekly():
    sql = render(
        "T35_weekly_revenue_trend",
        outlet_ids=[1, 2, 3],
        from_date="2026-02-01",
        to_date="2026-03-31",
    )
    assert "toMonday" in sql
    assert "week_start" in sql
    assert "outlet_id IN (1,2,3)" in sql
    assert "2026-02-01" in sql
    assert "2026-03-31" in sql


def test_render_t36_driver_bridge():
    sql = render(
        "T36_revenue_period_driver_bridge",
        outlet_ids=[1, 2],
        from_date_a="2026-01-01",
        to_date_a="2026-03-31",
        from_date_b="2025-07-01",
        to_date_b="2025-09-30",
    )
    assert "sumIf(net_revenue" in sql
    assert "from_date_a" not in sql
    assert "2026-01-01" in sql
    assert "2025-09-30" in sql


def test_render_t37_ai_sales_daily_outlets():
    sql = render("T37_ai_sales_daily_outlets", outlet_ids=[1, 2])

    assert "FROM analytics.ai_sales_daily" in sql
    assert "cdc.outlet FINAL" in sql
    assert "s.outlet_id IN (1,2)" in sql
    assert "business_date BETWEEN" not in sql


def test_render_missing_required_param():
    with pytest.raises(ValueError, match="Missing required params"):
        render("T01_daily_revenue", outlet_ids=[1])


def test_render_empty_outlet_ids_rejected():
    with pytest.raises(ValueError, match="cannot be empty"):
        render("T01_daily_revenue", outlet_ids=[], from_date="2026-01-01", to_date="2026-01-31")


def test_render_non_int_outlet_ids_rejected():
    with pytest.raises(ValueError, match="list\\[int\\]"):
        render(
            "T01_daily_revenue",
            outlet_ids=["1; DROP TABLE"],  # type: ignore
            from_date="2026-01-01",
            to_date="2026-01-31",
        )


def test_render_optional_param_default():
    sql = render(
        "T04_top_products",
        outlet_ids=[1],
        from_date="2026-01-01",
        to_date="2026-01-31",
    )
    assert "LIMIT 10" in sql  # default

    sql2 = render(
        "T04_top_products",
        outlet_ids=[1],
        from_date="2026-01-01",
        to_date="2026-01-31",
        limit=5,
    )
    assert "LIMIT 5" in sql2


def test_inventory_current_stock_templates_use_latest_scope_snapshot():
    sql = render("T12_inventory_low_stock", outlet_ids=[1, 2], threshold=0)

    assert "FROM cdc.inventory_transaction" in sql
    assert "SELECT max(business_date)" in sql
    assert "WHERE outlet_id IN (1,2)" in sql
    assert "HAVING qty_on_hand < 0" in sql
    assert "sum(qty_change) AS qty_on_hand" in sql
    assert "argMax" not in sql
    assert "sum(qty_on_hand)" not in sql


@pytest.mark.parametrize("key", sorted(TEMPLATES.keys()))
def test_every_template_passes_sql_guard(key):
    """Render with safe defaults, verify result passes SQL guard."""
    meta = TEMPLATES[key]
    params = {}
    for p in meta.required_params:
        if "date" in p:
            params[p] = "2026-01-01" if "from" in p else "2026-01-31"
        elif p == "limit":
            params[p] = 10
        elif p == "threshold":
            params[p] = 5
    sql = render(key, outlet_ids=[1, 2], **params)
    result = validate_sql(sql)
    assert result.passed, f"{key} failed guard: {result.violations}\nSQL:\n{sql}"
