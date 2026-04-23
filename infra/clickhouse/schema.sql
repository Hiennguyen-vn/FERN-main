CREATE DATABASE IF NOT EXISTS fern;

CREATE TABLE IF NOT EXISTS fern.fact_sale (
    sale_id UInt64,
    outlet_id UInt32,
    product_id UInt32,
    product_name String,
    category_id UInt32,
    qty Decimal(18,4),
    unit_price Decimal(18,2),
    discount_amount Decimal(18,2),
    line_total Decimal(18,2),
    payment_method LowCardinality(String),
    sale_status LowCardinality(String),
    sale_at DateTime64(3, 'Asia/Ho_Chi_Minh'),
    business_date Date,
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh'),
    device_id UInt64
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(sale_at)
ORDER BY (outlet_id, business_date, sale_at, sale_id);

CREATE TABLE IF NOT EXISTS fern.fact_inventory_movement (
    txn_id UInt64,
    outlet_id UInt32,
    item_id UInt32,
    qty_change Decimal(18,4),
    txn_type LowCardinality(String),
    txn_time DateTime64(3, 'Asia/Ho_Chi_Minh'),
    business_date Date
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(txn_time)
ORDER BY (outlet_id, item_id, txn_time);

CREATE TABLE IF NOT EXISTS fern.dim_product (
    product_id UInt32,
    name String,
    category_id UInt32,
    category_name String,
    updated_at DateTime64(3, 'Asia/Ho_Chi_Minh')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY product_id;

CREATE TABLE IF NOT EXISTS fern.dim_outlet (
    outlet_id UInt32,
    name String,
    region_id UInt32,
    updated_at DateTime64(3, 'Asia/Ho_Chi_Minh')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY outlet_id;
