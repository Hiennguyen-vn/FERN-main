-- Migration V003: flattened AI-facing metric views.
-- These views are intentionally denormalized so AIA-gent templates and
-- GenSQL can prefer single-table reads over complex joins.

CREATE DATABASE IF NOT EXISTS analytics;

DROP VIEW IF EXISTS analytics.ai_sales_daily;
DROP VIEW IF EXISTS analytics.ai_product_daily;
DROP VIEW IF EXISTS analytics.ai_pnl_daily;
DROP VIEW IF EXISTS analytics.ai_payment_daily;

CREATE OR REPLACE VIEW analytics.ai_sales_daily AS
SELECT
    sd.outlet_id AS outlet_id,
    any(o.code) AS outlet_code,
    any(o.name) AS outlet_name,
    sd.business_date AS business_date,
    sd.gross_revenue AS gross_revenue,
    sd.total_discount AS total_discount,
    sd.net_revenue AS net_revenue,
    sd.txn_count AS txn_count,
    if(sd.txn_count = 0, 0, sd.net_revenue / sd.txn_count) AS avg_basket_size,
    coalesce(any(c.cancelled_txn_count), 0) AS cancelled_txn_count,
    coalesce(any(c.cancelled_amount), 0) AS cancelled_amount,
    if(sd.txn_count + coalesce(any(c.cancelled_txn_count), 0) = 0, 0,
       coalesce(any(c.cancelled_txn_count), 0) / (sd.txn_count + coalesce(any(c.cancelled_txn_count), 0))) AS cancellation_rate
FROM analytics.fct_sales_daily AS sd
LEFT JOIN cdc.outlet AS o FINAL ON sd.outlet_id = o.id
LEFT JOIN (
    SELECT
        outlet_id,
        business_date,
        countIf(status IN ('cancelled', 'voided')) AS cancelled_txn_count,
        sumIf(total_amount, status IN ('cancelled', 'voided')) AS cancelled_amount
    FROM cdc.sale_record FINAL
    WHERE coalesce(__deleted, 'false') = 'false'
    GROUP BY outlet_id, business_date
) AS c ON sd.outlet_id = c.outlet_id AND sd.business_date = c.business_date
GROUP BY
    sd.outlet_id,
    sd.business_date,
    sd.gross_revenue,
    sd.total_discount,
    sd.net_revenue,
    sd.txn_count;

CREATE OR REPLACE VIEW analytics.ai_product_daily AS
SELECT
    pday.outlet_id AS outlet_id,
    any(o.code) AS outlet_code,
    any(o.name) AS outlet_name,
    pday.business_date AS business_date,
    pday.product_id AS product_id,
    any(pday.product_name) AS product_name,
    any(prod.category_code) AS category_code,
    pday.revenue AS revenue,
    pday.qty AS qty,
    pday.txn_count AS txn_count
FROM analytics.fct_sales_by_product AS pday
LEFT JOIN cdc.outlet AS o FINAL ON pday.outlet_id = o.id
LEFT JOIN cdc.product AS prod FINAL ON pday.product_id = prod.id
GROUP BY
    pday.outlet_id,
    pday.business_date,
    pday.product_id,
    pday.revenue,
    pday.qty,
    pday.txn_count;

CREATE OR REPLACE VIEW analytics.ai_pnl_daily AS
SELECT
    pnl.outlet_id AS outlet_id,
    any(o.code) AS outlet_code,
    any(o.name) AS outlet_name,
    pnl.business_date AS business_date,
    pnl.revenue AS revenue,
    pnl.cogs AS cogs,
    pnl.payroll_cost AS payroll_cost,
    pnl.operating_profit AS operating_profit,
    if(pnl.revenue = 0, 0, pnl.operating_profit / pnl.revenue) AS operating_margin
FROM analytics.fct_daily_pnl AS pnl
LEFT JOIN cdc.outlet AS o FINAL ON pnl.outlet_id = o.id
GROUP BY
    pnl.outlet_id,
    pnl.business_date,
    pnl.revenue,
    pnl.cogs,
    pnl.payroll_cost,
    pnl.operating_profit;

CREATE OR REPLACE VIEW analytics.ai_payment_daily AS
SELECT
    pay.outlet_id AS outlet_id,
    any(o.code) AS outlet_code,
    any(o.name) AS outlet_name,
    pay.business_date AS business_date,
    pay.payment_method AS payment_method,
    pay.revenue AS revenue,
    pay.txn_count AS txn_count
FROM analytics.fct_payment_split AS pay
LEFT JOIN cdc.outlet AS o FINAL ON pay.outlet_id = o.id
GROUP BY
    pay.outlet_id,
    pay.business_date,
    pay.payment_method,
    pay.revenue,
    pay.txn_count;
