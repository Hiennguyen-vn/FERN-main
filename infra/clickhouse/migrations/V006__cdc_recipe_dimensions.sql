-- Product recipes bridge sales products to inventory items.
-- These tables are replicated from PostgreSQL by Debezium/Kafka Connect.

CREATE TABLE IF NOT EXISTS cdc.item (
    id              Int64,
    code            String,
    name            String,
    category_code   Nullable(String),
    base_uom_code   String,
    min_stock_level Nullable(Decimal(18, 4)),
    max_stock_level Nullable(Decimal(18, 4)),
    status          LowCardinality(String),
    deleted_at      Nullable(DateTime64(3, 'Asia/Ho_Chi_Minh')),
    created_at      DateTime64(3, 'Asia/Ho_Chi_Minh'),
    updated_at      DateTime64(3, 'Asia/Ho_Chi_Minh'),
    version         Int32,
    `__op`          Nullable(String),
    `__ts_ms`       Int64 DEFAULT 0,
    `__lsn`         Nullable(Int64),
    `__deleted`     Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
ORDER BY id;

CREATE TABLE IF NOT EXISTS cdc.recipe (
    product_id         Int64,
    version            String,
    yield_qty          Decimal(18, 4),
    yield_uom_code     String,
    status             LowCardinality(String),
    created_by_user_id Nullable(Int64),
    created_at         DateTime64(3, 'Asia/Ho_Chi_Minh'),
    updated_at         DateTime64(3, 'Asia/Ho_Chi_Minh'),
    `__op`              Nullable(String),
    `__ts_ms`           Int64 DEFAULT 0,
    `__lsn`             Nullable(Int64),
    `__deleted`         Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
ORDER BY (product_id, version);

CREATE TABLE IF NOT EXISTS cdc.recipe_item (
    product_id Int64,
    version    String,
    item_id    Int64,
    uom_code   String,
    qty        Decimal(18, 4),
    created_at DateTime64(3, 'Asia/Ho_Chi_Minh'),
    updated_at DateTime64(3, 'Asia/Ho_Chi_Minh'),
    `__op`      Nullable(String),
    `__ts_ms`   Int64 DEFAULT 0,
    `__lsn`     Nullable(Int64),
    `__deleted` Nullable(String)
) ENGINE = ReplacingMergeTree(__ts_ms)
ORDER BY (product_id, version, item_id);
