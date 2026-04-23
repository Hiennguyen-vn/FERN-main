# 07 — Partitioning Strategy + Pricing Simplification

Addendum sau user clarify:

- Cần partition table theo thời gian.
- Pricing **chỉ theo chi nhánh** (không daypart, không channel-specific).
- Scope: coffee chain 1 brand (Highlands-style), 1 warehouse = 1 outlet.

## Pricing Simplified

### Hiện Trạng

[V1__core_schema.sql:912](../../db/migrations/V1__core_schema.sql):

```sql
CREATE TABLE core.product_price (
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  price_value NUMERIC(18,2) NOT NULL CHECK (price_value >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  ...
  PRIMARY KEY (product_id, outlet_id, effective_from)
);
```

**Đã match yêu cầu user**: pricing per `(product, outlet, effective_from)`. Không cần schema change.

### V14 Daypart — Bỏ?

V14 `catalog_menu_channel_daypart.sql` thêm daypart. User không dùng daypart pricing.

**Action**: giữ bảng `daypart` (có thể dùng cho menu visibility, không cho pricing). Nếu không dùng gì cả → drop ở V24.

### Channel-Specific Price (Grab/ShopeeFood)?

Nếu Highlands bán qua Grab giá khác giá quầy → cần channel dimension. Hiện scope user không nói → **bỏ qua**. Khi thêm Grab integration mới extend schema.

### Price Lookup Logic

Đơn giản: `WHERE product_id=? AND outlet_id=? AND effective_from <= today AND (effective_to IS NULL OR effective_to >= today)` → 1 row.

Nếu có nhiều row trùng time range → chọn `effective_from` lớn nhất (giá mới nhất). Cần constraint UNIQUE cover time range để tránh overlap? → PG exclusion constraint với btree_gist nếu cần strict:

```sql
-- Optional, thêm sau nếu có bug giá trùng range
ALTER TABLE core.product_price ADD CONSTRAINT excl_price_no_overlap
  EXCLUDE USING gist (
    product_id WITH =,
    outlet_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date)) WITH &&
  );
```

## Partition Strategy

### Vì Sao Partition

- Query báo cáo time-based scan phân vùng, không full-scan.
- Drop partition cũ = xóa data cũ nhanh (không VACUUM).
- Index nhỏ per partition, query plan tốt hơn.
- Maintenance (REINDEX) chạy per partition.

### Bảng Cần Partition (priority)

Dựa trên volume dự kiến coffee chain ~500 sale/outlet/day × 100 outlet × 365 ngày = **18M row/năm** cho sale_record. Trigger partition:

| Table | Current PK | Partition by | Interval | Priority |
|---|---|---|---|---|
| `sale_record` | `id` | `created_at` | monthly | P0 |
| `sale_item` | `id` | `created_at` | monthly | P0 |
| `payment` | `id` | `created_at` | monthly | P0 |
| `inventory_transaction` | `id` | `txn_time` | monthly | P0 |
| `sale_item_transaction` | `id` | `txn_time` | monthly | P1 |
| `audit_log` | `id` | `occurred_at` | monthly | P1 |
| `idempotency_keys` | `(service_name, idempotency_key)` | `created_at` | monthly | P2 |
| `outbox_event` (V19 mới) | `id` | `created_at` | monthly | P0 (thiết kế luôn partition) |

### Postgres Partition Constraint

**Partition key phải nằm trong PK**. Đổi PK từ `id` sang `(id, created_at)`.

- FK reference từ bảng con: sale_item → sale_record. FK phải match PK mới `(id, created_at)` → khó.
- **Workaround**: UNIQUE constraint `(id)` vẫn giữ (non-partition unique không cho phép, nhưng có thể tạo unique `(id, created_at)` và FK reference unique constraint đó).
- **Giải pháp**: FK reference chỉ `id`. Dùng `UNIQUE (id)` không khả thi cho partitioned → phải enforce qua application hoặc dùng tool như pg_partman với logical constraint.

### Migration Strategy — 2 Options

#### Option A: Partition mới từ cutover date (Recommend)

Không migrate data cũ. Tạo parent table partitioned song song, cutover application.

```sql
-- V24__partition_sale_record.sql

-- Step 1: rename bảng cũ
ALTER TABLE core.sale_record RENAME TO sale_record_legacy;

-- Step 2: tạo parent partitioned
CREATE TABLE core.sale_record (
  id BIGINT NOT NULL,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  pos_session_id BIGINT REFERENCES core.pos_session(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  order_type order_type_enum NOT NULL DEFAULT 'dine_in',
  status sale_order_status_enum NOT NULL DEFAULT 'open',
  payment_status payment_status_enum NOT NULL DEFAULT 'unpaid',
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_sale_record_discount CHECK (discount <= subtotal),
  CONSTRAINT chk_sale_record_total CHECK (
    total_amount = subtotal - discount + tax_amount
  ),
  PRIMARY KEY (id, created_at)  -- PK includes partition key
) PARTITION BY RANGE (created_at);

-- Step 3: tạo partitions đầu tiên
CREATE TABLE core.sale_record_2026_05 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE core.sale_record_2026_06 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
-- ... 12 tháng trước

-- Step 4: indexes per partition (auto qua template)
CREATE INDEX ON core.sale_record(outlet_id);
CREATE INDEX ON core.sale_record(pos_session_id);
CREATE INDEX ON core.sale_record(status);

-- Step 5: backfill data cũ (optional)
INSERT INTO core.sale_record
  SELECT *, 0 as version FROM core.sale_record_legacy;
-- Nếu data cũ <1M row, backfill OK. Nếu lớn, giữ legacy table cho archive.
```

#### Option B: pg_partman Auto-Management

Extension `pg_partman` tự tạo partition future + drop partition cũ theo retention policy.

```sql
SELECT partman.create_parent(
  p_parent_table => 'core.sale_record',
  p_control => 'created_at',
  p_type => 'range',
  p_interval => '1 month',
  p_premake => 12  -- tạo trước 12 tháng
);

UPDATE partman.part_config SET
  retention = '24 months',
  retention_keep_table = false,  -- drop partition cũ >24 tháng
  infinite_time_partitions = true
WHERE parent_table = 'core.sale_record';
```

Cron job nightly: `SELECT partman.run_maintenance();`.

**Recommend**: Option B + pg_partman — tự động hóa.

### FK Problem — Giải Pháp

FK từ `sale_item → sale_record` khi partition:

**Approach 1**: Bỏ FK ở DB level, enforce ở app. Trade-off: lose integrity safety.

**Approach 2**: FK composite `(sale_id, created_at)` trong sale_item → sale_record.

```sql
CREATE TABLE core.sale_item (
  id BIGINT NOT NULL,
  sale_id BIGINT NOT NULL,
  sale_created_at TIMESTAMPTZ NOT NULL,  -- denormalize để FK composite
  ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  FOREIGN KEY (sale_id, sale_created_at) REFERENCES core.sale_record(id, created_at)
) PARTITION BY RANGE (created_at);
```

Denormalize 1 column (`sale_created_at`) vào sale_item để FK composite work. App insert phải set.

**Recommend Approach 2** — giữ integrity.

### Partition Giữa payment, sale_item, sale_item_transaction

Cùng partition `created_at` monthly. FK composite `(parent_id, parent_created_at)`.

### inventory_transaction

Partition theo `txn_time`:

```sql
PARTITION BY RANGE (txn_time);
```

PK = `(id, txn_time)`.

### audit_log

Partition `occurred_at`:

```sql
PARTITION BY RANGE (occurred_at);
```

Retention 36 months (3 năm) theo requirement compliance.

### outbox_event (V19)

Thiết kế partition từ đầu:

```sql
CREATE TABLE core.outbox_event (
  id BIGINT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id BIGINT NOT NULL,
  topic TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  headers JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

Retention 90 days (đã plan docs/06). Partition monthly, drop partition >90 ngày tự động.

## Partition Pruning Verification

Query phải include partition column trong WHERE để pruning hoạt động:

```sql
-- GOOD: pruning
SELECT * FROM core.sale_record
WHERE created_at >= '2026-04-01' AND created_at < '2026-05-01'
  AND outlet_id = 123;

-- BAD: scan all partitions
SELECT * FROM core.sale_record WHERE id = 5678901234;
```

**App-side**: query luôn kèm time range. Nếu cần lookup by ID không có time → dùng index `(id)` per partition + loop partition → chậm. Tránh thiết kế này.

Báo cáo doanh thu, sync push event → luôn có time range → OK.

Idempotency lookup: dựa `idempotency_keys` partition theo `created_at`, key lookup cần `(service_name, key, created_at_range)`. Application truyền range "last 24h" khi check → pruning work.

## Retention Policy

| Table | Retention | Archive? |
|---|---|---|
| sale_record, sale_item, payment | Vô hạn (compliance) | Archive sang S3 sau 5 năm |
| inventory_transaction | Vô hạn | Archive sau 5 năm |
| audit_log | 3 năm (GDPR/VN compliance) | Drop |
| outbox_event | 90 ngày | Drop |
| idempotency_keys | 30 ngày | Drop |

Archive flow: pg_dump partition old → S3 parquet → drop partition. Tool `pg_partman` không archive built-in; viết script riêng.

## Migration Order

| Version | Migration | Depend on |
|---|---|---|
| V19 | `outbox_event` partitioned | — |
| V20 | `device_registry` | — |
| V21 | `payment_state` columns | V20 |
| V22 | `inventory_transaction` immutable trigger | V19 |
| V23 | `outbox_retention` + pg_partman config | V19 |
| V24 | `sale_record` + `sale_item` + `payment` partitioning | V21, V22, V23 |
| V25 | `inventory_transaction` partitioning | V22, V23 |
| V26 | `audit_log` partitioning | V23 |
| V27 | Optional `product_price` exclusion constraint (no overlap) | — |

## Verification

1. **Partition pruning**: `EXPLAIN (ANALYZE) SELECT * FROM core.sale_record WHERE created_at BETWEEN '2026-04-01' AND '2026-04-30';` → Plan hiển thị `Append` với 1 partition duy nhất.
2. **Auto-partition creation**: `pg_partman` chạy cron hàng đêm, check `pg_partman.part_config`, future partitions tồn tại 12 tháng tới.
3. **Drop old partition**: set retention 2 tháng cho test, verify partition >2 tháng bị drop.
4. **FK composite**: insert sale_item với sai `sale_created_at` → FK violation.
5. **Idempotency still works**: re-submit key cũ sau 24h → lookup by key + created_at range → hit cache đúng.
6. **Outbox relay pruning**: query `SELECT * FROM outbox_event WHERE status='PENDING' AND created_at > now() - interval '7 days'` → pruning, fast.
7. **Report query**: daily revenue query → partition pruning active, scan 1 partition/ngày.

## Tác Động App Code

- Insert: thêm field denormalized (`sale_created_at` trong sale_item) → sửa `SalesRepository.java:620-639`.
- Query by ID cũ (không có time range) → refactor để include time hint hoặc limit 24h window.
- Idempotency guard: hiện PK `(service_name, idempotency_key)`. Partition by `created_at` → lookup cần range. Sửa `IdempotencyGuard.execute()` truyền thêm window (ví dụ 7 ngày).
- Reporting query hiện tại: nếu chưa có time filter → gây full partition scan. Audit code report-service, bắt buộc time range.

## File Changes Summary

**Migrations mới**:

- V23__outbox_retention.sql (+ pg_partman setup for outbox)
- V24__partition_sales.sql (sale_record, sale_item, payment)
- V25__partition_inventory.sql
- V26__partition_audit.sql
- V27__product_price_no_overlap.sql (optional)

**Install extension** trước V23:

```sql
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
```

**Backend changes**:

- `common/service-common/.../repository/BaseRepository.java` — helper add time window to query.
- `services/sales-service/.../infrastructure/SalesRepository.java` — insert sale_item với `sale_created_at`.
- `services/*/infrastructure/*Repository.java` — audit query có time range.
- `common/idempotency-core/.../IdempotencyGuard.java` — lookup với window param.

**Ops setup**:

- `infra/docker-compose.yml` — Postgres image có pg_partman (vd `citusdata/postgres_partman` hoặc build custom).
- Cron pg_partman maintenance: nightly `run_maintenance()`.
- Monitoring: alert nếu partition future <2 tháng (chậm create).

## Open Decisions

1. **Retention sale_record**: vô hạn hay 5 năm + archive? (compliance VN thường yêu cầu 5-10 năm chứng từ kế toán).
2. **FK approach**: composite `(id, created_at)` (giữ integrity) vs bỏ FK (đơn giản)? Recommend composite.
3. **pg_partman hay tự viết**: recommend pg_partman.
4. **Backfill data cũ**: có → migrate vào partition mới; không → giữ legacy table archive.
5. **Daypart V14**: giữ cho menu visibility hay drop hẳn?

## Kết Luận

- Pricing: schema hiện tại `(product, outlet, effective_from)` đã đủ. Không đổi.
- Partition: thêm V23–V26 monthly partition cho 6 bảng hot. FK composite `(id, created_at)`. pg_partman tự động hóa.
- Impact app: sửa repository + idempotency guard thêm time window. Không đại phẫu.
- Đồng bộ roadmap offline-first: partition setup trước khi volume lớn, không block Phase 1-3.
