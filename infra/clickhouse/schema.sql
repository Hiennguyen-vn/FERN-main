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

-- ── W4.1 Event-stream tables (consumed from Kafka outbox topics) ──────────────

CREATE TABLE IF NOT EXISTS fern.events_sale_completed (
    eventId String,
    saleId UInt64,
    outletId UInt32,
    businessDate Date,
    totalAmount Decimal(18, 2),
    currencyCode LowCardinality(String),
    completedAt DateTime64(3, 'Asia/Ho_Chi_Minh'),
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh') DEFAULT now()
) ENGINE = ReplacingMergeTree(server_received_at)
PARTITION BY toYYYYMM(businessDate)
ORDER BY (outletId, businessDate, saleId, eventId);

CREATE TABLE IF NOT EXISTS fern.events_payment_captured (
    eventId String,
    saleId UInt64,
    outletId UInt32,
    businessDate Date,
    paymentMethod LowCardinality(String),
    amount Decimal(18, 2),
    currencyCode LowCardinality(String),
    capturedAt DateTime64(3, 'Asia/Ho_Chi_Minh'),
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh') DEFAULT now()
) ENGINE = ReplacingMergeTree(server_received_at)
PARTITION BY toYYYYMM(businessDate)
ORDER BY (outletId, businessDate, saleId, eventId);

CREATE TABLE IF NOT EXISTS fern.events_stock_low (
    eventId String,
    outletId UInt32,
    itemId UInt32,
    qtyOnHand Decimal(18, 4),
    reorderThreshold Decimal(18, 4),
    detectedAt DateTime64(3, 'Asia/Ho_Chi_Minh'),
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh') DEFAULT now()
) ENGINE = ReplacingMergeTree(server_received_at)
PARTITION BY toYYYYMM(detectedAt)
ORDER BY (outletId, itemId, detectedAt, eventId);

CREATE TABLE IF NOT EXISTS fern.events_expense_created (
    eventId String,
    expenseId UInt64,
    sourceId UInt64,
    outletId UInt32,
    amount Decimal(18, 2),
    currencyCode LowCardinality(String),
    createdAt DateTime64(3, 'Asia/Ho_Chi_Minh'),
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh') DEFAULT now()
) ENGINE = ReplacingMergeTree(server_received_at)
PARTITION BY toYYYYMM(createdAt)
ORDER BY (outletId, createdAt, expenseId, eventId);

CREATE TABLE IF NOT EXISTS fern.events_invoice_issued (
    eventId String,
    invoiceId UInt64,
    saleId UInt64,
    outletId UInt32,
    invoiceNumber String,
    issuedAt DateTime64(3, 'Asia/Ho_Chi_Minh'),
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh') DEFAULT now()
) ENGINE = ReplacingMergeTree(server_received_at)
PARTITION BY toYYYYMM(issuedAt)
ORDER BY (outletId, issuedAt, invoiceId, eventId);

CREATE TABLE IF NOT EXISTS fern.events_goods_receipt_posted (
    eventId String,
    goodsReceiptId UInt64,
    purchaseOrderId UInt64,
    supplierId UInt64,
    outletId UInt32,
    businessDate Date,
    totalPrice Decimal(18, 2),
    currencyCode LowCardinality(String),
    postedAt DateTime64(3, 'Asia/Ho_Chi_Minh'),
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh') DEFAULT now()
) ENGINE = ReplacingMergeTree(server_received_at)
PARTITION BY toYYYYMM(businessDate)
ORDER BY (outletId, businessDate, goodsReceiptId, eventId);

CREATE TABLE IF NOT EXISTS fern.events_invoice_approved (
    eventId String,
    supplierInvoiceId UInt64,
    supplierId UInt64,
    outletId Nullable(UInt32),
    invoiceDate Date,
    totalAmount Decimal(18, 2),
    currencyCode LowCardinality(String),
    approvedAt DateTime64(3, 'Asia/Ho_Chi_Minh'),
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh') DEFAULT now()
) ENGINE = ReplacingMergeTree(server_received_at)
PARTITION BY toYYYYMM(invoiceDate)
ORDER BY (supplierId, invoiceDate, supplierInvoiceId, eventId);

CREATE TABLE IF NOT EXISTS fern.events_payroll_approved (
    eventId String,
    payrollId UInt64,
    payrollPeriodId UInt64,
    userId UInt64,
    outletId Nullable(UInt32),
    netSalary Decimal(18, 2),
    currencyCode LowCardinality(String),
    approvedAt DateTime64(3, 'Asia/Ho_Chi_Minh'),
    server_received_at DateTime64(3, 'Asia/Ho_Chi_Minh') DEFAULT now()
) ENGINE = ReplacingMergeTree(server_received_at)
PARTITION BY toYYYYMM(approvedAt)
ORDER BY (payrollPeriodId, userId, approvedAt, eventId);
