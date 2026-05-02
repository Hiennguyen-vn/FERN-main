-- Migration V001: analytics.* views for ai-query-service
-- Apply: clickhouse-client < V001__analytics_views.sql
-- Idempotent: uses CREATE OR REPLACE VIEW.

CREATE DATABASE IF NOT EXISTS analytics;

-- ── Daily sales aggregation (by outlet) ──────────────────────────────────────
CREATE OR REPLACE VIEW analytics.fct_sales_daily AS
SELECT
    outlet_id,
    business_date,
    countDistinct(sale_id)          AS txn_count,
    sum(line_total)                 AS gross_revenue,
    sum(discount_amount)            AS total_discount,
    sum(line_total - discount_amount) AS net_revenue,
    sum(qty)                        AS total_qty
FROM fern.fact_sale
WHERE sale_status != 'CANCELLED'
GROUP BY outlet_id, business_date;

-- ── Sales by category ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW analytics.fct_sales_by_category AS
SELECT
    fs.outlet_id,
    fs.business_date,
    fs.category_id,
    any(p.category_name) AS category_name,
    sum(fs.line_total)   AS revenue,
    sum(fs.qty)          AS qty
FROM fern.fact_sale fs
LEFT JOIN (SELECT product_id, category_name FROM fern.dim_product FINAL) p ON fs.product_id = p.product_id
WHERE fs.sale_status != 'CANCELLED'
GROUP BY fs.outlet_id, fs.business_date, fs.category_id;

-- ── Sales by product ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW analytics.fct_sales_by_product AS
SELECT
    outlet_id,
    business_date,
    product_id,
    any(product_name) AS product_name,
    sum(line_total)   AS revenue,
    sum(qty)          AS qty,
    count()           AS txn_count
FROM fern.fact_sale
WHERE sale_status != 'CANCELLED'
GROUP BY outlet_id, business_date, product_id;

-- ── Inventory snapshot (running balance per outlet+item+date) ────────────────
CREATE OR REPLACE VIEW analytics.fct_inventory_snapshot AS
SELECT
    outlet_id,
    item_id,
    business_date,
    sum(qty_change) AS qty_on_hand
FROM fern.fact_inventory_movement
GROUP BY outlet_id, item_id, business_date;

-- ── Daily P&L (revenue - cogs - payroll) ─────────────────────────────────────
CREATE OR REPLACE VIEW analytics.fct_daily_pnl AS
SELECT
    sd.outlet_id,
    sd.business_date,
    sd.net_revenue                  AS revenue,
    coalesce(gr.cogs, 0)            AS cogs,
    coalesce(pr.payroll_cost, 0)    AS payroll_cost,
    sd.net_revenue
        - coalesce(gr.cogs, 0)
        - coalesce(pr.payroll_cost, 0) AS operating_profit
FROM analytics.fct_sales_daily sd
LEFT JOIN (
    SELECT outletId AS outlet_id, businessDate AS business_date, sum(totalPrice) AS cogs
    FROM fern.events_goods_receipt_posted
    GROUP BY outletId, businessDate
) gr ON sd.outlet_id = gr.outlet_id AND sd.business_date = gr.business_date
LEFT JOIN (
    SELECT outletId AS outlet_id, toDate(approvedAt) AS business_date, sum(netSalary) AS payroll_cost
    FROM fern.events_payroll_approved
    WHERE outletId IS NOT NULL
    GROUP BY outletId, toDate(approvedAt)
) pr ON sd.outlet_id = pr.outlet_id AND sd.business_date = pr.business_date;

-- ── Payment method split ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW analytics.fct_payment_split AS
SELECT
    outlet_id,
    business_date,
    payment_method,
    count()         AS txn_count,
    sum(line_total) AS revenue
FROM fern.fact_sale
WHERE sale_status != 'CANCELLED'
GROUP BY outlet_id, business_date, payment_method;
