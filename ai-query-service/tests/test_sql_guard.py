from app.guard.sql_ast import validate_sql


def test_valid_select_passes():
    sql = """
    SELECT outlet_id, sum(net_revenue)
    FROM analytics.fct_sales_daily
    WHERE outlet_id IN (1, 2, 3)
      AND business_date BETWEEN '2026-01-01' AND '2026-01-31'
    GROUP BY outlet_id
    """
    result = validate_sql(sql)
    assert result.passed, result.violations


def test_event_table_outletid_camelcase():
    sql = """
    SELECT outletId, sum(amount)
    FROM fern.events_payment_captured
    WHERE outletId IN (1, 2)
    GROUP BY outletId
    """
    result = validate_sql(sql)
    assert result.passed, result.violations


def test_missing_outlet_filter_rejected():
    sql = "SELECT * FROM analytics.fct_sales_daily WHERE business_date = today()"
    result = validate_sql(sql)
    assert not result.passed
    assert any("outlet_id" in v for v in result.violations)


def test_nested_outlet_filter_does_not_scope_outer_query():
    sql = """
    SELECT sum(net_revenue)
    FROM analytics.fct_sales_daily
    WHERE business_date = today()
      AND EXISTS (
        SELECT 1
        FROM analytics.fct_sales_daily
        WHERE outlet_id IN (1)
      )
    """
    result = validate_sql(sql)
    assert not result.passed
    assert any("Missing outlet_id" in v for v in result.violations)


def test_insert_rejected():
    sql = "INSERT INTO analytics.fct_sales_daily VALUES (1, 100)"
    result = validate_sql(sql)
    assert not result.passed


def test_drop_rejected():
    sql = "DROP TABLE fern.fact_sale"
    result = validate_sql(sql)
    assert not result.passed


def test_non_whitelist_schema_rejected():
    sql = "SELECT * FROM system.users WHERE outlet_id IN (1)"
    result = validate_sql(sql)
    assert not result.passed
    assert any("Schema" in v or "system" in v for v in result.violations)


def test_unqualified_table_rejected():
    sql = "SELECT * FROM users WHERE outlet_id IN (1)"
    result = validate_sql(sql)
    assert not result.passed


def test_blocked_function_system():
    sql = "SELECT system('rm -rf /') FROM analytics.fct_sales_daily WHERE outlet_id IN (1)"
    result = validate_sql(sql)
    assert not result.passed


def test_union_rejected():
    sql = """
    SELECT outlet_id FROM analytics.fct_sales_daily WHERE outlet_id IN (1)
    UNION ALL
    SELECT outlet_id FROM analytics.fct_sales_daily WHERE outlet_id IN (999)
    """
    result = validate_sql(sql)
    assert not result.passed


def test_parse_error_rejected():
    sql = "SELECT FROM WHERE"
    result = validate_sql(sql)
    assert not result.passed


def test_join_with_two_whitelisted_tables():
    sql = """
    SELECT s.outlet_id, p.category_name, sum(s.line_total)
    FROM fern.fact_sale s
    JOIN fern.dim_product p ON s.product_id = p.product_id
    WHERE s.outlet_id IN (1, 2)
    GROUP BY s.outlet_id, p.category_name
    """
    result = validate_sql(sql)
    assert result.passed, result.violations
