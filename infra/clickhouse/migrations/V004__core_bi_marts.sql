-- Migration V004: core BI marts for ai-query semantic correctness.
--
-- These views keep the P1 BI surface focused on sales, finance, and inventory.
-- In particular:
--   * goods receipt is procurement intake cost, not COGS;
--   * inventory movement is not the same thing as on-hand stock;
--   * current stock uses a running balance over inventory transactions.

CREATE DATABASE IF NOT EXISTS analytics;

DROP VIEW IF EXISTS analytics.ai_sales_hourly;
DROP VIEW IF EXISTS analytics.ai_finance_daily;
DROP VIEW IF EXISTS analytics.ai_inventory_movement_daily;
DROP VIEW IF EXISTS analytics.ai_inventory_on_hand_daily;

CREATE OR REPLACE VIEW analytics.ai_sales_hourly AS
SELECT
    sr.outlet_id AS outlet_id,
    any(o.code) AS outlet_code,
    any(o.name) AS outlet_name,
    sr.business_date AS business_date,
    toHour(sr.created_at) AS hour_of_day,
    sum(sr.total_amount) AS net_revenue,
    countDistinct(sr.id) AS txn_count,
    if(countDistinct(sr.id) = 0, 0, sum(sr.total_amount) / countDistinct(sr.id)) AS avg_ticket
FROM cdc.sale_record AS sr FINAL
LEFT JOIN cdc.outlet AS o FINAL ON sr.outlet_id = o.id
WHERE lower(sr.status) NOT IN ('cancelled', 'voided', 'open')
  AND coalesce(sr.__deleted, 'false') = 'false'
GROUP BY
    sr.outlet_id,
    sr.business_date,
    toHour(sr.created_at);

CREATE OR REPLACE VIEW analytics.ai_finance_daily AS
SELECT
    b.outlet_id AS outlet_id,
    any(o.code) AS outlet_code,
    any(o.name) AS outlet_name,
    b.business_date AS business_date,
    coalesce(any(s.revenue), 0) AS revenue,
    CAST(0, 'Decimal(18, 2)') AS actual_or_theoretical_cogs,
    coalesce(any(gr.goods_receipt_cost), 0) AS goods_receipt_cost,
    coalesce(any(pr.payroll_cost), 0) AS payroll_cost,
    coalesce(any(ex.expense_amount), 0) AS expense_amount,
    revenue - actual_or_theoretical_cogs AS gross_profit,
    revenue - actual_or_theoretical_cogs - payroll_cost - expense_amount AS operating_profit,
    if(revenue = 0, 0, operating_profit / revenue) AS margin,
    'goods_receipt_cost is procurement intake; not treated as COGS in this mart' AS cost_caveat
FROM (
    SELECT outlet_id, business_date
    FROM analytics.ai_sales_daily
    UNION DISTINCT
    SELECT outletId AS outlet_id, businessDate AS business_date
    FROM fern.events_goods_receipt_posted
    UNION DISTINCT
    SELECT outletId AS outlet_id, toDate(createdAt) AS business_date
    FROM fern.events_expense_created
    UNION DISTINCT
    SELECT outletId AS outlet_id, toDate(approvedAt) AS business_date
    FROM fern.events_payroll_approved
    WHERE outletId IS NOT NULL
) AS b
LEFT JOIN (
    SELECT
        outlet_id,
        business_date,
        sum(net_revenue) AS revenue
    FROM analytics.ai_sales_daily
    GROUP BY outlet_id, business_date
) AS s ON b.outlet_id = s.outlet_id AND b.business_date = s.business_date
LEFT JOIN (
    SELECT
        outletId AS outlet_id,
        businessDate AS business_date,
        sum(totalPrice) AS goods_receipt_cost
    FROM fern.events_goods_receipt_posted
    GROUP BY outletId, businessDate
) AS gr ON b.outlet_id = gr.outlet_id AND b.business_date = gr.business_date
LEFT JOIN (
    SELECT
        outletId AS outlet_id,
        toDate(createdAt) AS business_date,
        sum(amount) AS expense_amount
    FROM fern.events_expense_created
    GROUP BY outletId, toDate(createdAt)
) AS ex ON b.outlet_id = ex.outlet_id AND b.business_date = ex.business_date
LEFT JOIN (
    SELECT
        outletId AS outlet_id,
        toDate(approvedAt) AS business_date,
        sum(netSalary) AS payroll_cost
    FROM fern.events_payroll_approved
    WHERE outletId IS NOT NULL
    GROUP BY outletId, toDate(approvedAt)
) AS pr ON b.outlet_id = pr.outlet_id AND b.business_date = pr.business_date
LEFT JOIN cdc.outlet AS o FINAL ON b.outlet_id = o.id
GROUP BY
    b.outlet_id,
    b.business_date;

CREATE OR REPLACE VIEW analytics.ai_inventory_movement_daily AS
SELECT
    it.outlet_id AS outlet_id,
    any(o.code) AS outlet_code,
    any(o.name) AS outlet_name,
    it.business_date AS business_date,
    it.item_id AS item_id,
    it.txn_type AS movement_type,
    sum(it.qty_change) AS qty_change,
    count() AS movement_count
FROM cdc.inventory_transaction AS it FINAL
LEFT JOIN cdc.outlet AS o FINAL ON it.outlet_id = o.id
WHERE coalesce(it.__deleted, 'false') = 'false'
GROUP BY
    it.outlet_id,
    it.business_date,
    it.item_id,
    it.txn_type;

CREATE OR REPLACE VIEW analytics.ai_inventory_on_hand_daily AS
SELECT
    outlet_id,
    outlet_code,
    outlet_name,
    business_date,
    item_id,
    sum(qty_delta) OVER (
        PARTITION BY outlet_id, item_id
        ORDER BY business_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS qty_on_hand,
    qty_delta AS movement_qty
FROM (
    SELECT
        it.outlet_id AS outlet_id,
        any(o.code) AS outlet_code,
        any(o.name) AS outlet_name,
        it.business_date AS business_date,
        it.item_id AS item_id,
        sum(it.qty_change) AS qty_delta
    FROM cdc.inventory_transaction AS it FINAL
    LEFT JOIN cdc.outlet AS o FINAL ON it.outlet_id = o.id
    WHERE coalesce(it.__deleted, 'false') = 'false'
    GROUP BY
        it.outlet_id,
        it.business_date,
        it.item_id
);
