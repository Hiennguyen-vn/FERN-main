-- Migration V002: CDC target schema (Int64 IDs to match Postgres BIGINT)
-- Purpose: Debezium → Kafka → ClickHouse sink writes here.
-- Separate from fern.* (UInt32) to avoid breaking existing consumers.

CREATE DATABASE IF NOT EXISTS cdc;

-- ── fact_sale = mirror of core.sale_item ──
CREATE TABLE IF NOT EXISTS cdc.fact_sale (
    sale_id           Int64,
    sale_created_at   DateTime64(3, 'Asia/Ho_Chi_Minh'),
    outlet_id         Int64,
    product_id        Int64,
    unit_price        Decimal(18, 2),
    qty               Decimal(18, 4),
    discount_amount   Decimal(18, 2),
    tax_amount        Decimal(18, 2),
    line_total        Decimal(18, 2),
    business_date     Date MATERIALIZED toDate(if(toHour(sale_created_at) < 2, sale_created_at - INTERVAL 1 DAY, sale_created_at)),
    `__op`            Nullable(String),
    `__ts_ms`         Int64 DEFAULT 0,
    `__lsn`           Nullable(Int64),
    `__deleted`       Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
PARTITION BY toYYYYMM(business_date)
ORDER BY (outlet_id, sale_id, product_id);

-- ── sale_record header ──
CREATE TABLE IF NOT EXISTS cdc.sale_record (
    id              Int64,
    outlet_id       Int64,
    status          LowCardinality(String),
    payment_status  LowCardinality(String),
    subtotal        Decimal(18, 2),
    discount        Decimal(18, 2),
    tax_amount      Decimal(18, 2),
    total_amount    Decimal(18, 2),
    created_at      DateTime64(3, 'Asia/Ho_Chi_Minh'),
    updated_at      DateTime64(3, 'Asia/Ho_Chi_Minh'),
    business_date   Date MATERIALIZED toDate(if(toHour(created_at) < 2, created_at - INTERVAL 1 DAY, created_at)),
    `__op`          Nullable(String),
    `__ts_ms`       Int64 DEFAULT 0,
    `__lsn`         Nullable(Int64),
    `__deleted`     Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
PARTITION BY toYYYYMM(business_date)
ORDER BY (outlet_id, id);

-- ── payment ──
CREATE TABLE IF NOT EXISTS cdc.payment (
    sale_id         Int64,
    outlet_id       Int64,
    payment_method  LowCardinality(String),
    amount          Decimal(18, 2),
    state           LowCardinality(String),
    payment_time    Nullable(DateTime64(3, 'Asia/Ho_Chi_Minh')),
    created_at      DateTime64(3, 'Asia/Ho_Chi_Minh'),
    business_date   Date MATERIALIZED toDate(if(toHour(created_at) < 2, created_at - INTERVAL 1 DAY, created_at)),
    `__op`          Nullable(String),
    `__ts_ms`       Int64 DEFAULT 0,
    `__lsn`         Nullable(Int64),
    `__deleted`     Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
PARTITION BY toYYYYMM(business_date)
ORDER BY (outlet_id, sale_id, payment_method);

-- ── inventory_transaction ──
CREATE TABLE IF NOT EXISTS cdc.inventory_transaction (
    id              Int64,
    outlet_id       Int64,
    item_id         Int64,
    qty_change      Decimal(18, 4),
    txn_type        LowCardinality(String),
    txn_time        DateTime64(3, 'Asia/Ho_Chi_Minh'),
    business_date   Date MATERIALIZED toDate(if(toHour(txn_time) < 2, txn_time - INTERVAL 1 DAY, txn_time)),
    `__op`          Nullable(String),
    `__ts_ms`       Int64 DEFAULT 0,
    `__lsn`         Nullable(Int64),
    `__deleted`     Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
PARTITION BY toYYYYMM(business_date)
ORDER BY (outlet_id, item_id, txn_time, id);

-- ── Dimensions ──
CREATE TABLE IF NOT EXISTS cdc.outlet (
    id          Int64,
    code        String,
    name        String,
    region_id   Int64,
    status      LowCardinality(String),
    address     Nullable(String),
    phone       Nullable(String),
    created_at  DateTime64(3, 'Asia/Ho_Chi_Minh'),
    updated_at  DateTime64(3, 'Asia/Ho_Chi_Minh'),
    `__op`      Nullable(String),
    `__ts_ms`   Int64 DEFAULT 0,
    `__lsn`     Nullable(Int64),
    `__deleted` Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
ORDER BY id;

CREATE TABLE IF NOT EXISTS cdc.product (
    id            Int64,
    code          String,
    name          String,
    category_code Nullable(String),
    status        LowCardinality(String),
    created_at    DateTime64(3, 'Asia/Ho_Chi_Minh'),
    updated_at    DateTime64(3, 'Asia/Ho_Chi_Minh'),
    `__op`        Nullable(String),
    `__ts_ms`     Int64 DEFAULT 0,
    `__lsn`       Nullable(Int64),
    `__deleted`   Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
ORDER BY id;

-- ── analytics.* views over cdc.* ──
DROP VIEW IF EXISTS analytics.fct_sales_daily;
DROP VIEW IF EXISTS analytics.fct_sales_by_category;
DROP VIEW IF EXISTS analytics.fct_sales_by_product;
DROP VIEW IF EXISTS analytics.fct_inventory_snapshot;
DROP VIEW IF EXISTS analytics.fct_daily_pnl;
DROP VIEW IF EXISTS analytics.fct_payment_split;

CREATE OR REPLACE VIEW analytics.fct_sales_daily AS
SELECT
    s.outlet_id,
    s.business_date,
    countDistinct(s.id)  AS txn_count,
    sum(s.subtotal)      AS gross_revenue,
    sum(s.discount)      AS total_discount,
    sum(s.total_amount)  AS net_revenue
FROM cdc.sale_record AS s FINAL
WHERE s.status NOT IN ('cancelled', 'voided', 'open')
  AND coalesce(s.__deleted, 'false') = 'false'
GROUP BY s.outlet_id, s.business_date;

CREATE OR REPLACE VIEW analytics.fct_sales_by_product AS
SELECT
    fs.outlet_id      AS outlet_id,
    fs.business_date  AS business_date,
    fs.product_id     AS product_id,
    any(p.name)        AS product_name,
    sum(fs.line_total) AS revenue,
    sum(fs.qty)        AS qty,
    count()            AS txn_count
FROM cdc.fact_sale AS fs FINAL
INNER JOIN (SELECT id, status FROM cdc.sale_record FINAL WHERE status NOT IN ('cancelled', 'voided', 'open')) sr
       ON fs.sale_id = sr.id
LEFT JOIN (SELECT id, name, category_code FROM cdc.product FINAL) p ON fs.product_id = p.id
GROUP BY fs.outlet_id, fs.business_date, fs.product_id;

CREATE OR REPLACE VIEW analytics.fct_sales_by_category AS
SELECT
    fs.outlet_id      AS outlet_id,
    fs.business_date  AS business_date,
    p.category_code    AS category_code,
    any(p.name)        AS category_name,
    sum(fs.line_total) AS revenue,
    sum(fs.qty)        AS qty
FROM cdc.fact_sale AS fs FINAL
INNER JOIN (SELECT id, status FROM cdc.sale_record FINAL WHERE status NOT IN ('cancelled', 'voided', 'open')) sr
       ON fs.sale_id = sr.id
LEFT JOIN (SELECT id, name, category_code FROM cdc.product FINAL) p ON fs.product_id = p.id
GROUP BY fs.outlet_id, fs.business_date, p.category_code;

CREATE OR REPLACE VIEW analytics.fct_inventory_snapshot AS
SELECT
    outlet_id,
    item_id,
    business_date,
    sum(qty_change) AS qty_on_hand
FROM cdc.inventory_transaction FINAL
GROUP BY outlet_id, item_id, business_date;

CREATE OR REPLACE VIEW analytics.fct_payment_split AS
SELECT
    outlet_id,
    business_date,
    payment_method,
    count()      AS txn_count,
    sum(amount)  AS revenue
FROM cdc.payment FINAL
WHERE state IN ('COMPLETED', 'RECONCILED')
GROUP BY outlet_id, business_date, payment_method;

CREATE OR REPLACE VIEW analytics.fct_daily_pnl AS
SELECT
    sd.outlet_id                    AS outlet_id,
    sd.business_date                AS business_date,
    sd.net_revenue                  AS revenue,
    coalesce(gr.cogs, 0)            AS cogs,
    coalesce(pr.payroll_cost, 0)    AS payroll_cost,
    sd.net_revenue
        - coalesce(gr.cogs, 0)
        - coalesce(pr.payroll_cost, 0) AS operating_profit
FROM analytics.fct_sales_daily AS sd
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
