# 00 — Current State Audit

Audit sâu mã hiện tại để xác định gap với target offline-first. Mọi kết luận có file:line.

## 1. Stack Tổng Thể

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 18 + Vite + shadcn/ui + Tailwind | [frontend/package.json](../../frontend/package.json) |
| State | TanStack Query v5 + `persistQueryClient` localStorage | [frontend/src/App.tsx:52-71](../../frontend/src/App.tsx) |
| Backend | Spring Boot 12 service Java, pure JDBC (no JPA) | [services/](../../services/) |
| DB | PostgreSQL 1 schema `core` dùng chung | [db/migrations/](../../db/migrations/) |
| Messaging | Kafka, topic pattern `fern.<domain>.<Event>` | |
| Cache | Redis (price cache, idempotency L1) | |
| Migration | Flyway V1→V18 **thiếu V13** | |

## 2. Sale Path Frontend → Backend

### 2.1 Submit Order Flow — `frontend/src/routes/pos-order/hooks/use-submit-order.ts`

- **Line 233**: `const key = crypto.randomUUID()` — client sinh idempotency key.
- **Lines 247-257**: `PendingSnapshot` shape = `{idempotencyKey, phase, saleId, outlet, lines, previewTotal, backendTotal}`.
- **Line 263**: POST `/api/v1/sales/orders` header `Idempotency-Key`.
- **Lines 75-95**: `pos-order-pending-{idempotencyKey}` snapshot trong localStorage; phase machine `creating → created → approving → approved → paying → paid`.
- **Lines 276-278**: Chuỗi 3 call: `createOrder → approveOrder → markPaymentDone`.
- **Line 307**: Retry dùng lại idempotency key.

### 2.2 SalesController — `services/sales-service/.../api/SalesController.java`

- `POST /orders` line 58 — accept `Idempotency-Key` header.
- `POST /orders/{saleId}/approve` line 147.
- `POST /orders/{saleId}/mark-payment-done` line 157.
- `GET /orders` list line 93-121 — pagination + filter.

### 2.3 SalesService — `services/sales-service/.../application/SalesService.java`

- Line 38-43: `IdempotencyGuard` + `TypedKafkaEventPublisher` injected.
- Line 128-150 `submitSale`: normalize key (line 137) → `idempotencyGuard.execute(...)` wrap repository call, TtlPolicy.BET. Return cached response on replay.
- Line 314 `markPaymentDone` → publish `SaleCompletedEvent`.
- Lines 533-557 `publishSaleCompletedEvents` payload includes mọi sale_item + unit_price + qty + discount + tax.

### 2.4 SalesRepository — `services/sales-service/.../infrastructure/SalesRepository.java`

- **Line 564**: `long saleId = snowflakeIdGenerator.generateId()` — **server-side ID**.
- Lines 589-612: INSERT `sale_record`.
- Lines 620-639: INSERT `sale_item` với `unit_price` snapshot.
- Line 579: `BigDecimal unitPrice = line.unitPrice()` — unit price được load từ `product_price` ở `aggregateLines()` lúc submit. **Snapshot vào row sale_item khi insert → immutable.** ✓

**Quan trọng**: giá snapshot đúng nghĩa — sale_item.unit_price không JOIN lại product_price sau này.

## 3. Inventory Ledger

### 3.1 Consumer — `services/inventory-service/.../application/InventoryEventConsumer.java`

- Lines 36-65: `@KafkaListener(topics = "fern.sales.sale-completed")`.
- Lines 49-61: wrap `idempotencyGuard.execute(envelope.eventId(), ...)`.
- Line 55: `inventoryService.applySaleCompleted(event)`.

### 3.2 Service — `services/inventory-service/.../application/InventoryService.java`

- Lines 176-205 `@Transactional applySaleCompleted`:
  - Map sale line → recipe components.
  - Deduction = `qty * component_qty / yield_qty`.
  - Line 194 insert inventory_transaction rows.
  - Lines 201-203 publish `StockLowThresholdEvent`.

### 3.3 Repository append-only

- Grep UPDATE/DELETE trên `inventory_transaction` → **không có**. ✓
- Insert-only qua `applySaleCompleted`.

### 3.4 Migrations inventory

- [V1__core_schema.sql](../../db/migrations/V1__core_schema.sql) lines 272-306: `apply_stock_delta()` — UPSERT `stock_balance`.
- Lines 308-352: trigger `sync_stock_balance` ON INSERT/UPDATE/DELETE `inventory_transaction`:
  - ON UPDATE: reverse old, apply new (324-341).
  - ON DELETE: reverse (343-350).
- [V8__fix_stock_balance_delta_guard.sql](../../db/migrations/V8__fix_stock_balance_delta_guard.sql): trigger `prevent_negative_stock_balance`.

**Observation**: trigger hỗ trợ UPDATE/DELETE — không phải hard append-only ở DB level. App convention mới giữ append-only. Risk nếu future code UPDATE row: double deduction bị reverse sai.

## 4. Catalog & Price

### 4.1 Publish Version — `db/migrations/V15__catalog_publish_and_audit.sql`

- Lines 7-27 `publish_version`: `id, name, status (draft/review/approved/scheduled/published/rolled_back)`.
- Lines 34-52 `publish_item`: `entity_type, change_type, before_snapshot jsonb, after_snapshot jsonb`.
- Lines 55-75 `catalog_audit_log`: field-level audit.

### 4.2 Product Price

- V1 `product_price`: PK `(product_id, outlet_id, effective_from)`. Columns: `price_value, effective_from, effective_to`.
- Index `idx_product_price_product_outlet_effective_to`.
- Per-outlet + time-bound versioning. ✓

### 4.3 Menu

- [services/product-service/.../api/MenuController.java](../../services/product-service/src/main/java/com/fern/services/product/api/MenuController.java) — CRUD menu.
- Per-outlet menu assignment qua publish flow.

## 5. Event Publishing (Current)

### 5.1 Publisher — `common/service-common/.../kafka/TypedKafkaEventPublisher.java`

- Lines 30-57: `publish()` **synchronous blocking**.
- `UUID.randomUUID()` event id.
- `KafkaProducer.send()` trực tiếp.
- **Không transactional**: publish sau DB commit → risk lost event nếu Kafka fail.

### 5.2 Publish sites (grep kafkaEventPublisher.publish)

| Service | Events |
|---|---|
| sales-service | SaleCompletedEvent, PaymentCapturedEvent (lines 533, 560) |
| inventory-service | StockLowThresholdEvent (line 223) |
| product-service | 2 publish sites |
| auth-service | UserCreatedEvent, RoleUpdatedEvent |
| org-service | OutletCreatedEvent + 4 others |

### 5.3 Outbox

- **Không có** outbox table hoặc relay code. Grep "outbox" → 0.

## 6. Auth & Token

### 6.1 AuthService — `services/auth-service/spring/.../application/AuthService.java`

- Line 69: `@Value("${security.jwt.access-token-ttl-seconds:3600}")` — **default 1h**.
- Lines 97-105 `issueAccessToken`: claims = `userId, username, sessionId, rolesByOutlet, permissionsByOutlet, allOutletIds`.
- Lines 128-154 `refresh`: issue new token cùng TTL.
- **Không có claim offline/grace**.

## 7. POS Session & Reconciliation

### 7.1 SalesRepository POS session — lines 58-200

- `openPosSession()` lines 58-90: INSERT `pos_session (session_code, outlet_id, currency_code, manager_id, opened_at, business_date, status='open', note)`.
- `closePosSession()` lines 92-141: validate no unpaid orders → UPDATE status='closed'.
- `reconcilePosSession()` lines 143-200:
  - Lines 163-167: load expected totals by payment method.
  - Lines 180-191: INSERT `pos_session_reconciliation (expected_total, actual_total, discrepancy_total)`.
  - Line 192: UPDATE status='reconciled'.

Cash counting đã có logic variance. ✓

## 8. Data Model Boundaries

- Single schema `core` share bởi 12 service.
- Multi-tenant row-based: `outlet_id` ở hầu hết table.
- Stock per-outlet: `stock_balance.location_id`, `inventory_transaction.outlet_id`.
- Cross-service FK tồn tại:
  - `sale_record → outlet(id)`
  - `sale_item → product(id)`
  - `inventory_transaction → outlet(id), item(id)`
  - Services communicate qua Kafka event nhưng FK DB thì đan chéo.

## 9. Điểm Mạnh (Tận Dụng)

| Điểm | File |
|---|---|
| Idempotency 2-tier Redis+PG | [common/idempotency-core/.../IdempotencyGuard.java](../../common/idempotency-core/src/main/java/com/dorabets/idempotency/IdempotencyGuard.java) |
| Snowflake ID app-side | [common/common-utils/.../SnowflakeIdGenerator.java](../../common/common-utils/src/main/java/com/natsu/common/utils/services/id/SnowflakeIdGenerator.java) |
| React Query persist | [frontend/src/App.tsx:52-71](../../frontend/src/App.tsx) |
| Pending snapshot state machine | [use-submit-order.ts:75-95](../../frontend/src/routes/pos-order/hooks/use-submit-order.ts) |
| unit_price snapshot sale_item | SalesRepository line 579 |
| Inventory consumer idempotent | InventoryEventConsumer:49 |
| POS session reconciliation có variance | SalesRepository:180-191 |

## 10. Gap với Offline-First

| # | Blocker | File:Line | Impact |
|---|---|---|---|
| G1 | Server-side sale ID | SalesRepository:564 | Client offline không sinh được ID hợp lệ |
| G2 | Sync Kafka publish | TypedKafkaEventPublisher:53 | Event loss nếu Kafka fail sau DB commit |
| G3 | Không outbox | — | At-least-once không guarantee |
| G4 | Price lookup lúc submit | SalesRepository:567 (aggregateLines) | Client offline cần pre-cache price, risk giá cũ |
| G5 | POS session FK check | SalesRepository:554-560 | Offline cần cache session info |
| G6 | JWT TTL 1h, no offline claim | AuthService:69 | Offline dài = expire |
| G7 | Không Service Worker / PWA | frontend/ | Không intercept offline, không install-able |
| G8 | Không catalog delta API | — | POS phải load full catalog mỗi lần |
| G9 | Payment states đơn giản `unpaid/paid` | core.payment | Thiếu `PENDING_OFFLINE/RECONCILED` |
| G10 | Trigger inventory cho phép UPDATE/DELETE | V1:324-350 | Rủi ro double-reverse nếu code sai |
| G11 | Worker-id snowflake hash hostname | SnowflakeIdGenerator | Collision nếu 2 POS cùng hostname |
| G12 | V13 migration gap | db/migrations/ | Flyway `outOfOrder` ngầm |

## 11. Latency Baseline (Cần Đo Thực Tế Phase 0)

Chưa có số đo. Cần bench:

- Network RTT frontend → sales-service.
- DB commit `submitSale` end-to-end.
- Kafka publish latency.
- Consumer apply inventory.

Dùng làm mốc đánh giá outbox polling 1s có đủ hay không.

## 12. Kết Luận

Foundation tốt cho offline-first nhờ idempotency + snowflake + unit_price snapshot + inventory append-only consumer. Nhưng cần vá 12 gap, đặc biệt G1 (client ID), G2-G3 (outbox), G6 (token lease), G7 (PWA). Chi tiết implementation ở [05-implementation-plan.md](05-implementation-plan.md).
