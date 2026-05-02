# Kiến Trúc Dữ Liệu — ai-query-service (Option B: CDC + ClickHouse)

> Tài liệu này mô tả đường đi dữ liệu từ lúc user tạo order/payment/payroll cho đến khi ai-query-service trả lời câu hỏi.

---

## 1. Câu Hỏi Quan Trọng: Có Phải "Ghi Đồng Thời"?

**KHÔNG.** Spring services CHỈ ghi PostgreSQL. ClickHouse được sync **bất đồng bộ** qua CDC pipeline.

```
KHÔNG PHẢI:
  Spring service ──┬──► Postgres (sync)
                   └──► ClickHouse (sync)        ← KHÔNG có dual-write

THỰC TẾ:
  Spring service ──► Postgres ─[WAL]─► Debezium ─► Kafka ─► CH Sink ─► ClickHouse
                     (sync)            (async, eventual consistency 2-10s)
```

### Lý do không dual-write

1. **Spring services không biết ClickHouse tồn tại** — không cần coupling
2. **Transaction integrity** — chỉ Postgres giữ ACID. Dual-write 2 DB → distributed transaction phức tạp
3. **Failure isolation** — ClickHouse down không block POS bán hàng
4. **CDC = single source of truth** — Postgres luôn correct, ClickHouse mirror

### Trade-off: Eventual consistency

- ai-query-service trả số liệu **lag 2-10s** so với Postgres
- F&B analytics chấp nhận được (không phải payment processing)
- "Doanh thu hôm nay" với 10s lag vẫn dùng được

---

## 2. Tổng Quan Pipeline

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         WRITE PATH (Synchronous)                         │
│                                                                          │
│  POS App / Web UI                                                        │
│        │ HTTPS                                                           │
│        ▼                                                                 │
│  Gateway (port 8080)                                                     │
│        │ JWT validated, X-Internal-* headers injected                   │
│        ▼                                                                 │
│  Spring Service (sales / inventory / payroll / ...)                     │
│        │                                                                 │
│        ├─► Validate business rules                                      │
│        ├─► BEGIN TRANSACTION                                             │
│        ├─► INSERT/UPDATE core.* tables                                  │
│        ├─► INSERT outbox event (for domain events)                      │
│        └─► COMMIT                                                        │
│              │                                                           │
│              ▼ (response 200 OK to user)                                │
└──────────────┼───────────────────────────────────────────────────────────┘
               │
               │ WAL flushed to disk
               │
┌──────────────┼───────────────────────────────────────────────────────────┐
│              ▼          READ PATH (Async CDC)                            │
│                                                                          │
│  PostgreSQL Primary (5432) ─── streaming replication ──► Replica (5433) │
│        │                                                                 │
│        │ pgoutput logical replication slot                              │
│        ▼                                                                 │
│  Debezium PostgreSQL Source Connector (Kafka Connect)                   │
│        │ Reads WAL → emits row-change events                            │
│        ▼                                                                 │
│  Kafka Topics:                                                           │
│    fern.cdc.core.sale_record           (key = outlet_id)                │
│    fern.cdc.core.sale_item                                              │
│    fern.cdc.core.payment                                                │
│    fern.cdc.core.inventory_transaction                                  │
│    fern.cdc.core.payroll                                                │
│    fern.cdc.core.outlet, fern.cdc.core.product (dimensions)             │
│        │                                                                 │
│        ▼                                                                 │
│  ClickHouse Sink Connector                                               │
│    - SMT: compute business_date (logic ca đêm 02:00)                   │
│    - SMT: denormalize product_name, category_name                       │
│    - Type cast: BIGINT → Int64                                           │
│    - Batch 1000 rows / 5s                                                │
│        │                                                                 │
│        ▼                                                                 │
│  ClickHouse fern.* (raw layer)                                           │
│    fact_sale, fact_inventory_movement, dim_outlet, dim_product, ...      │
│        │                                                                 │
│        │ Materialized View triggers tự động                              │
│        ▼                                                                 │
│  ClickHouse analytics.* (aggregated layer)                              │
│    fct_sales_daily, fct_sales_by_category, fct_daily_pnl, ...           │
│        │                                                                 │
│        ▼                                                                 │
│  ai-query-service (port 8093)                                            │
│    User question → LangGraph → SQL → answer                             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Flow Cụ Thể Theo Loại Transaction

### 3.1. Tạo Order (Sale)

**T=0ms — User nhấn "Thanh toán" tại POS:**
```
POST /api/v1/sales/orders
{
  "outlet_id": 5,
  "items": [{"product_id": 101, "qty": 2, "unit_price": 35000}, ...],
  "payment": {"method": "CARD", "amount": 70000}
}
```

**T=2-50ms — sales-service xử lý:**
```sql
BEGIN;
INSERT INTO core.sale_record (id, outlet_id, total_amount, status, ...)
  VALUES (snowflake_id(), 5, 70000, 'completed', now());

INSERT INTO core.sale_item (sale_id, product_id, qty, unit_price, line_total)
  VALUES (sale_id, 101, 2, 35000, 70000);

INSERT INTO core.payment (sale_id, method, amount, captured_at)
  VALUES (sale_id, 'CARD', 70000, now());

INSERT INTO core.outbox (event_type, payload)
  VALUES ('SALE_COMPLETED', '{...}');  -- domain event
COMMIT;
```
→ **Response 200 OK trả về POS** (user thấy ngay)

**T=5-20ms — Postgres WAL flushed, replica catch up.**

**T=50-500ms — Debezium đọc WAL:**
- Phát hiện 3 row INSERT (sale_record, sale_item, payment)
- Emit 3 messages tới 3 Kafka topics:
  - `fern.cdc.core.sale_record` partition=hash(outlet_id=5)%12
  - `fern.cdc.core.sale_item`
  - `fern.cdc.core.payment`

**T=200ms-2s — ClickHouse sink consume:**
- Batch buffer (max 1000 rows / 5s timeout)
- Apply SMT:
  - Compute `business_date = toDate(if(toHour(created_at) < 2, created_at - 1 DAY, created_at))`
  - Lookup `dim_product` để denormalize `product_name`, `category_name`
- Bulk INSERT vào `fern.fact_sale`

**T=2-5s — Materialized view tự refresh:**
- AggregatingMergeTree trigger trên INSERT raw
- Update partition `analytics.fct_sales_daily WHERE outlet_id=5 AND business_date=today()`
- Merge với existing aggregate state (incremental, không full rebuild)

**T=5s+ — Available cho ai-query-service:**
- User hỏi "Doanh thu outlet Q1 hôm nay"
- ai-query-service → ClickHouse → trả số liệu

### 3.2. Tạo Inventory Transaction (Goods Receipt / Stock Move)

**T=0ms — Manager nhập "Nhận hàng":**
```
POST /api/v1/procurement/goods-receipts
{
  "outlet_id": 5,
  "items": [{"item_id": 5001, "qty": 50, "unit_cost": 12000}]
}
```

**T=2-30ms — procurement-service:**
```sql
BEGIN;
INSERT INTO core.goods_receipt (id, outlet_id, supplier_id, total_amount, ...)
  VALUES (...);

-- Inventory transaction tự động cho mỗi item
INSERT INTO core.inventory_transaction (outlet_id, item_id, qty_change, txn_type, txn_time)
  VALUES (5, 5001, 50, 'GOODS_RECEIPT', now());

INSERT INTO core.outbox VALUES ('GOODS_RECEIPT_POSTED', '{...}');
COMMIT;
```

**T=200ms-2s — CDC flow:**
- `fern.cdc.core.inventory_transaction` → ClickHouse `fern.fact_inventory_movement`
- `fern.cdc.core.goods_receipt` → ClickHouse `fern.events_goods_receipt_posted`
- Outbox event → `fern.procurement.goods-receipt-posted` (cho services khác consume)

**T=2-5s:**
- `analytics.fct_inventory_snapshot` MV update qty_on_hand cho (outlet=5, item=5001)
- `analytics.fct_daily_pnl` update cogs cho ngày hôm nay

### 3.3. Tạo Kỳ Lương (Payroll Period)

**T=0ms — HR Manager phê duyệt kỳ lương:**
```
POST /api/v1/payroll/payroll-periods/{id}/approve
```

**T=10-100ms — payroll-service:**
```sql
BEGIN;
UPDATE core.payroll_period SET status='APPROVED', approved_at=now() WHERE id=...;

-- Mỗi nhân viên 1 row
INSERT INTO core.payroll (period_id, user_id, outlet_id, gross_salary, deductions, net_salary, ...)
  SELECT period_id, user_id, outlet_id, ...
  FROM core.payroll_calculation_temp;

INSERT INTO core.outbox VALUES ('PAYROLL_APPROVED', '{...}');
COMMIT;
```

**T=200ms-3s — CDC + outbox:**
- `fern.cdc.core.payroll` (raw rows) → ClickHouse `fern.fact_payroll` (nếu có)
- Outbox `fern.payroll.payroll-approved` → ClickHouse `fern.events_payroll_approved`

**T=3-10s:**
- `analytics.fct_daily_pnl` MV update `payroll_cost` cho mỗi outlet trong kỳ lương
- ai-query-service trả lời "Chi phí lương tháng này outlet Q1?" với data mới

---

## 4. Tại Sao Dùng CDC Thay Vì Dual-Write

### Dual-write (KHÔNG dùng) — vấn đề:

```
sales-service:
  postgres.commit()      ← thành công
  clickhouse.insert()    ← timeout / lỗi
  // Bây giờ data inconsistent giữa 2 DB
  // Rollback Postgres? User đã thấy 200 OK rồi
  // Retry ClickHouse? Idempotent? Phức tạp
```

### CDC (đang dùng) — ưu điểm:

```
sales-service:
  postgres.commit()      ← single transaction, ACID
  // Done, return 200 OK

  // CDC tự động pickup, retry built-in
  // ClickHouse down → Kafka buffer → catch up khi up lại
  // Không bao giờ mất data (RF=3, retention 7 days)
```

### So sánh

| Aspect | Dual-Write | CDC |
|--------|-----------|-----|
| Coupling | Service ↔ ClickHouse | Service KHÔNG biết ClickHouse |
| Failure handling | Distributed txn / saga | Auto retry built-in |
| Consistency | Có thể inconsistent | Eventual (2-10s lag) |
| Schema change | Update tất cả services | Update Debezium config |
| Add new sink | Update tất cả services | Subscribe Kafka topic mới |
| Latency POS | Cao (chờ 2 DB) | Thấp (chỉ Postgres) |

---

## 5. Lag Expectation

### Steady state (idle hour)

| Stage | Latency |
|-------|---------|
| Spring service write | 5-50ms |
| Postgres WAL flush | <10ms |
| Debezium pickup | <100ms |
| Kafka publish | <50ms |
| Sink batch wait | 0-5000ms (5s timeout) |
| ClickHouse INSERT | 10-100ms |
| MV refresh | 50-500ms |
| **Total** | **~2-10s** |

### Peak load (giờ vàng F&B 11h-13h, 18h-20h)

- 100+ orders/giây across chain
- Sink batch fill nhanh hơn → flush 1-2s
- **Lag thực tế: 1-3s**

### Disaster (ClickHouse down 1 giờ)

- Spring services KHÔNG bị ảnh hưởng (vẫn ghi Postgres)
- Kafka buffer accumulate (RF=3, retention 7 days = thừa sức)
- ClickHouse up lại → sink catch up từ Kafka offset
- **No data loss**, lag temporary tăng → giảm về normal

---

## 6. Outbox vs CDC — Hai Loại Event

FERN dùng **CẢ HAI** loại stream song song:

### CDC stream (`fern.cdc.core.*`)
- Auto-generated từ Debezium
- 1 row change → 1 message
- Dùng cho: sync data tới ClickHouse, search index, etc.
- KHÔNG có business semantic

### Outbox / Domain events (`fern.sales.*`, `fern.payroll.*`, ...)
- Application code emit thủ công
- 1 business action → 1+ messages
- Dùng cho: cross-service communication, business logic
- CÓ business semantic ("PAYROLL_APPROVED", "STOCK_LOW")

ai-query-service dùng **chủ yếu CDC** (cho fact tables), kết hợp **outbox** (cho events_* tables).

---

## 7. ClickHouse Layers

### Layer 1: `fern.*` (raw mirror của Postgres)
```sql
fern.fact_sale           ← mirror core.sale_record + sale_item join
fern.fact_inventory_movement ← mirror core.inventory_transaction
fern.dim_outlet          ← mirror core.outlet (ReplacingMergeTree)
fern.dim_product         ← mirror core.product
fern.events_*            ← from outbox topics
```

Mục đích: source of truth trong ClickHouse, query được trực tiếp nhưng chậm hơn.

### Layer 2: `analytics.*` (aggregated, query fast)
```sql
analytics.fct_sales_daily       ← AggregatingMergeTree, partition by month
analytics.fct_sales_by_category ← pre-joined with dim_product
analytics.fct_sales_by_product
analytics.fct_inventory_snapshot
analytics.fct_daily_pnl         ← revenue - cogs - payroll
analytics.fct_payment_split
```

Mục đích: ai-query-service query layer này. 100M rows aggregate → <100ms.

---

## 8. Failure Modes

| Scenario | Impact | Recovery |
|----------|--------|----------|
| Postgres primary down | Service down, không bán được hàng | Replica promote (manual / Patroni) |
| Postgres replica down | Other read services lag | Restart, catch up từ WAL |
| Debezium connector crash | CDC lag tăng | Auto resume từ replication slot |
| Kafka broker down (1/3) | RF=3 nên vẫn run | Auto re-replicate |
| Kafka broker down (2/3) | min_isr=2 → write blocked | Restart broker |
| ClickHouse sink crash | Lag tăng | Auto resume từ Kafka offset |
| ClickHouse server down | ai-query-service 503 | Restart, MV rebuild from raw |
| MV corruption | Wrong numbers | DROP + INSERT INTO ... SELECT từ raw |
| ai-query-service down | Q&A unavailable | Restart, không ảnh hưởng data |

**No data loss scenario nào** vì Kafka retention 7 days + Postgres là source of truth.

---

## 9. Type Mapping (Postgres → ClickHouse)

| Postgres | ClickHouse | Notes |
|----------|-----------|-------|
| `bigint` (snowflake ID) | `Int64` | KHÔNG dùng UInt32 — overflow |
| `numeric(18,2)` | `Decimal(18,2)` | Exact financial |
| `text` | `String` | LZ4 compression |
| `varchar(N)` (status enum) | `LowCardinality(String)` | Dictionary encoding |
| `timestamp with time zone` | `DateTime64(3, 'Asia/Ho_Chi_Minh')` | Preserve TZ |
| `date` | `Date` | |
| `boolean` | `Bool` | |
| `uuid` | `UUID` | |
| `jsonb` | `String` (JSON) | Query qua JSONExtract |

---

## 10. Business Date Logic

F&B ca đêm kết thúc 02:00 sáng hôm sau. Tất cả views dùng:

```sql
toDate(if(toHour(created_at) < 2,
          created_at - INTERVAL 1 DAY,
          created_at)) AS business_date
```

Áp dụng tại sink SMT, KHÔNG để application compute.

Ví dụ:
- Sale tạo lúc `2026-05-03 23:30:00` → `business_date = 2026-05-03`
- Sale tạo lúc `2026-05-04 01:30:00` → `business_date = 2026-05-03` (vẫn ca tối hôm trước)
- Sale tạo lúc `2026-05-04 02:30:00` → `business_date = 2026-05-04`

---

## 11. Retention Strategy

| Layer | Hot (3 months) | Warm (1 year) | Cold (5+ years) |
|-------|----------------|---------------|-----------------|
| Postgres `core.*` | All in primary | Partitioned (auto) | Detach old partitions, archive S3 |
| Kafka topics | 7 days | DLQ only | — |
| ClickHouse `fern.*` (raw) | All | All compressed | TTL move to S3 |
| ClickHouse `analytics.*` (agg) | All | All | All (small size, keep forever) |

---

## 12. Câu Trả Lời Tóm Tắt

> **Q: Khi tạo order/transaction/kỳ lương sẽ được ghi đồng thời vào ClickHouse luôn đúng không?**
>
> **A: KHÔNG.**
>
> Spring services CHỈ ghi Postgres (single transaction, ACID).
>
> ClickHouse nhận data **bất đồng bộ** qua CDC pipeline (Debezium → Kafka → ClickHouse Sink).
>
> Lag steady-state: **2-10 giây**. Peak load: 1-3s. Không bao giờ mất data (Kafka RF=3 + Postgres source of truth).
>
> Lý do: tách coupling, failure isolation, ACID integrity, no distributed transaction.
