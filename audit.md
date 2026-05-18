# FERN — Báo Cáo Thẩm Định Kiến Trúc (v3)

**Ngày:** 2026-04-28
**Phạm vi:** Chuỗi đồ uống Highland-style (50-80 SKU, peak 7-9h, no hot kitchen)
**Trạng thái verify:** Đã đối chiếu code + migration thực tế repo `/FERN-main`
**Điểm tổng:** **8.0 / 10** (sau Sprint 1-3 thực thi: V54-V60 + sync hardening + admin UI + IT)

## CẬP NHẬT v3 — Đã Implement

| Sprint | Hạng mục | Status |
|---|---|---|
| 1 | V59 statement_timeout + PgBouncer (opt-in) | ✅ |
| 1 | V54 legacy_price + drift detection | ✅ |
| 1 | V55 modifier-aware inventory deduction (4 effect types) | ✅ |
| 1 | V56 stock reservation + advisory layer + sweep job | ✅ |
| 1 | V57 cash movement ledger + variance view | ✅ |
| 1 | V58 loyalty MVP (customer + ledger + OTP mock) | ✅ |
| 2 | V60 sale_record customer link + auto-earn wire | ✅ |
| 2 | Ed25519 manifest signing + edge verifier | ✅ |
| 2 | Dexie sweeper hook + storage telemetry | ✅ |
| 2 | DLT replay endpoint + admin UI | ✅ |
| 2 | Keypair gen tool + env config | ✅ |
| 3 | Integration test suite (PriceDriftIT 3/3) | ✅ |
| 3 | Frontend AdminModule (4 pages) | ✅ |

**Test count:** 101 → 116 (+15, all green).
**Migration count:** V53 → V60 (+7 new).
**Backend new files:** 9. **Edge new files:** 2. **Frontend new files:** 6.

---

## TÓM TẮT EXECUTIVE

FERN có nền tảng **mạnh hơn dự đoán ban đầu**. Verify code thực tế:

**Đã có (vượt mong đợi):**
- ✅ Modifier system đầy đủ (V16, V39) — variant + modifier_group + sale_item_modifier
- ✅ Catalog versioning đa chiều (catalog/price/stock/recipe/menu version)
- ✅ DLQ coverage 100% trên 4 Kafka consumers verified
- ✅ OpenTelemetry wired (`micrometer-tracing-bridge-otel`)
- ✅ Vault deps + manifest (Spring Cloud Vault 4.2.0)
- ✅ Server-authoritative time (clamp +5 phút)
- ✅ Lock ordering ASC trong checkout (verified `ORDER BY si.product_id`)
- ✅ Promotion engine có (BxGy, combo, subsidy)
- ✅ E-invoice nội bộ (V38) — số seri, VAT, outlet sequence
- ✅ Recipe/BOM (V1)
- ✅ API versioning `/api/v1/`

**Thiếu chí tử cho chuỗi đồ uống:**
- ❌ Channel adapters (Grab/Shopee/Be) — 0%
- ❌ Loyalty/CRM/customer table — 0% (chỉ có endpoint placeholder)
- ❌ VN payment providers (VietQR/MoMo/ZaloPay/VNPay) — 0%
- ❌ Modifier-aware inventory deduction (no-sugar vs normal-sugar trừ kho như nhau!)
- ❌ Hóa đơn điện tử VN gov sync (Viettel/VNPT/MISA)
- ❌ Happy hour / time-based pricing
- ❌ Cash-in/cash-out ledger detailed
- ❌ Stock reservation pattern (chỉ có FOR UPDATE)
- ❌ Statement timeout + PgBouncer
- ❌ Catalog manifest signing
- ❌ Dexie TTL automatic cleanup

**Coverage:** 36 test / 133 main = **27%** (thấp cho hệ tài chính, target 70%).

---

## 1. KIỂM TRA HIỆN TRẠNG (Verified)

### 1.1 Modifier System ✅ EXISTS

**File:** [db/migrations/V16__product_variants_modifiers.sql:5-56](db/migrations/V16__product_variants_modifiers.sql#L5-L56), [V39__hub_register_sales_detail.sql](db/migrations/V39__hub_register_sales_detail.sql)

**Có:**
- `product_variant`, `modifier_group`, `modifier_option`, `product_modifier_group`
- `modifier_option.price_adjustment NUMERIC(15,2)` → price delta đã hỗ trợ
- `modifier_group.selection_type` (single/multiple), `min_selections`, `max_selections`
- `sale_item_modifier` track modifier per line item

**Gap nghiêm trọng:** **Modifier-aware inventory deduction = MISSING**.
- `core.inventory_transaction` không có `modifier_option_id` FK
- "Phin Sữa Đá không đường" và "bình thường" trừ kho **giống hệt nhau**
- Topping trân châu thêm 30g không trừ riêng

**Action P0:**
```sql
ALTER TABLE core.recipe_item ADD COLUMN modifier_option_id BIGINT NULL;
-- Recipe có thể attach vào modifier (e.g. "thêm trân châu" → +30g topping)
-- Hoặc consumption_ratio table riêng cho modifier
```

### 1.2 Channel Adapters ❌ MISSING

**Tác động:** Chuỗi đồ uống VN 30-40% doanh thu qua Grab/Shopee/Be. Không có = mất gần nửa doanh thu.

**Cần build:**
- `services/channel-service/` mới
- Adapter pattern: GrabFoodAdapter, ShopeeFoodAdapter, BeFoodAdapter
- Webhook idempotency: key = `{channel}:{external_order_id}` → wire vào IdempotencyGuard có sẵn
- Status sync 2 chiều + saga cancellation
- OAuth + token refresh per channel

**Effort:** 1.5-2 tháng/3 channels.

### 1.3 Payment Integration ⚠️ PARTIAL

**File:** [services/sales-service/.../PaymentStateMachine.java:20-51](services/sales-service/src/main/java/com/fern/services/sales/application/PaymentStateMachine.java)
**File:** [db/migrations/V1__core_schema.sql:111-118](db/migrations/V1__core_schema.sql#L111-L118)

**Có:** State machine `PENDING_OFFLINE → QUEUED → COMPLETED → RECONCILED`. Enum generic: `cash`, `card`, `ewallet`, `bank_transfer`, `cheque`, `voucher`.

**Thiếu:** VietQR, MoMo, ZaloPay, VNPay, Payoo provider code = 0%.

**Khuyến nghị thứ tự:**
1. **VietQR trước** — phí 0%, settle T+0. Tích hợp qua Payoo/VNPay gateway 1-lần dùng nhiều.
2. MoMo, ZaloPay sau (phí 1-1.5%).
3. Card (Napas/Visa/Master) Phase 2 — kéo theo PCI-DSS scope.

### 1.4 Loyalty / Customer / CRM ❌ MISSING

**Verify:** Đã grep toàn bộ 53 migration. **Không có `customer` table**. Endpoint `/api/v1/crm` tồn tại nhưng không có backing implementation.

**Tác động Highland-clone:** Critical. App + tích điểm = sống còn.

**MVP P0:**
```sql
CREATE TABLE crm.customer (
  id BIGINT PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  phone_verified_at TIMESTAMPTZ,
  full_name VARCHAR(255),
  birthday DATE,
  consent_marketing BOOL DEFAULT false,  -- PDPL compliance
  consent_data_processing BOOL NOT NULL,
  points_balance INT DEFAULT 0,
  tier VARCHAR(20) DEFAULT 'BRONZE',
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL  -- soft delete cho right-to-erasure
);
CREATE TABLE crm.points_ledger (...);  -- audit append-only
CREATE TABLE crm.otp_request (...);    -- rate limit by phone
```

**Compliance VN:** Nghị định 13/2023 (PDPL) — consent + erasure flow bắt buộc.

### 1.5 Cash Drawer Reconciliation ⚠️ PARTIAL

**File:** [db/migrations/V1__core_schema.sql:1098-1100](db/migrations/V1__core_schema.sql), [V11__pos_session_reconciliation.sql](db/migrations/V11__pos_session_reconciliation.sql)

**Có:** `pos_session` với status `reconciled`. Variance generated column `actual_qty - system_qty`.

**Thiếu:** Cash-in/cash-out transaction ledger detail (đổi tiền lẻ, paid-out cho ship đá, rút nộp ngân hàng).

**Action P0:**
```sql
CREATE TABLE pos.cash_movement (
  id BIGINT PRIMARY KEY,
  session_id BIGINT,
  type VARCHAR(20),  -- open_float, paid_in, paid_out, sale_cash, drop, close_count
  amount NUMERIC(15,2),
  reason VARCHAR(255),
  approved_by_user_id BIGINT,
  created_at TIMESTAMPTZ
);
```
Force reconciliation trước close shift. Variance > 50k cảnh báo manager.

### 1.6 Hóa Đơn Điện Tử VN ⚠️ PARTIAL

**File:** [db/migrations/V38__internal_invoice.sql:15-57](db/migrations/V38__internal_invoice.sql#L15-L57)

**Có:** `finance.invoice`, `finance.invoice_line`, `outlet_invoice_sequence`, VAT cents, seller tax code, `cqt_status = 'internal_only'`.

**Thiếu:** Sync với CQT (Cơ quan thuế) qua Viettel/VNPT/MISA.

**Action P0 (pháp lý bắt buộc Nghị định 123):**
- Tích hợp 1 nhà cung cấp (recommend Viettel hoặc VNPT — phổ biến nhất)
- Field bổ sung: `cqt_invoice_no`, `cqt_signed_at`, `cqt_xml`, `cqt_response_code`
- Async job submit invoice → poll status → update
- Retry với exponential backoff
- Effort: ~1 người-tháng (API CQT phức tạp)

### 1.7 Stock Reservation ⚠️ PARTIAL — chỉ FOR UPDATE

**File:** `services/inventory-service/.../InventoryRepository.java`

**Có:** Pessimistic lock `FOR UPDATE OF it`. Lock order ASC verified.

**Risk peak 7-9h:** 1 store Highland 150 ly/giờ. Lock contention SKU hot (Phin Sữa Đá, Bạc Xỉu) → wait queue dài → checkout chậm.

**Pattern khuyến nghị:**
```
Insert vào stock_reservation (no lock, append-only)
↓
Async settlement job: aggregate reservations → trừ stock_balance batch
↓
Periodic compaction
```
Giảm lock contention 90% trên SKU hot. Đã có outbox pattern, mở rộng thêm reservation table.

### 1.8 Catalog Versioning ✅ EXISTS

**File:** [services/sales-service/.../SyncService.java:416-449](services/sales-service/src/main/java/com/fern/services/sales/application/SyncService.java#L416-L449)

**Có:** Manifest `/api/v1/sync/manifest`. 5 version: `catalog_version`, `price_version`, `stock_version`, `recipe_version`, `menu_version`. Computed `MAX(EXTRACT(EPOCH FROM updated_at))`.

**Thiếu:** Cryptographic signing manifest. Edge có thể bị MITM/tamper.

**Action P1:**
- Sign manifest bằng Ed25519. Edge verify public key embedded.
- Detect rollback: edge reject nếu version < last_seen_version.

### 1.9 Dexie TTL ⚠️ PARTIAL

**File:** client-side audit cache schema and flush path.

**Có:** `forwarded_at` tracking. `expires_at` cho credential cache. Manual flush.

**Thiếu:** Automatic TTL cleanup — entry `forwarded_at IS NOT NULL AND created_at < now() - 90d` không bị xóa tự động.

**Risk:** Device chạy 6-12 tháng → Dexie >1GB → tab freeze.

**Action P1:**
```typescript
// Background sweeper mỗi 24h
async function sweepDexie() {
  const cutoff = Date.now() - 90 * 86400_000;
  await db.audit_local
    .where('forwarded_at').above(0)
    .and(r => r.created_at < cutoff)
    .delete();
  // Check storage estimate, alert if > 70%
  const est = await navigator.storage.estimate();
  if (est.usage / est.quota > 0.7) postTelemetry('dexie_storage_high');
}
```

### 1.10 Server-Authoritative Time ✅ EXISTS

**File:** `services/sales-service/.../SalesService.java:~580` — `serverReceived = clock.instant()`, clamp future +5min.

**Đủ tốt.** Đề xuất bổ sung: emit metric `client_clock_skew_seconds` để phát hiện device giờ lệch nặng.

### 1.11 DLQ Coverage ✅ COMPLETE (4/4)

| Service | File | Retry | DLT |
|---|---|---|---|
| finance | FinanceEventConsumer.java:77-110 | ✅ 3 | ✅ |
| inventory | InventoryEventConsumer.java:49-194 | ✅ 4 | ✅ |
| audit | AuditEventConsumer.java:47-194 | ✅ 1 | ✅ |
| auth | OrgEventConsumer.java:46-79 | ✅ 3 | ✅ |

Tốt. **Cần thêm:** DLT monitoring + replay tooling. DLT có message nhưng không ai biết → cần Grafana panel + manual replay endpoint.

### 1.12 OpenTelemetry ✅ EXISTS

`micrometer-tracing-bridge-otel` ở pom.xml + filter `CorrelationIdToTraceFilter`. **Verify:** OTEL collector + backend (Tempo/Jaeger) đã deploy chưa? Cần check infra/.

### 1.13 Vault ⚠️ CONFIG ONLY

Spring Cloud Vault 4.2.0 + manifest `infra/vault/prod/vault-ha-raft.yaml`. **Chưa verify** services thực sự pull secret từ Vault hay vẫn dùng env var. Cần grep `@VaultPropertySource` hoặc bootstrap.yml.

**Action P0:** Audit toàn bộ secret usage. Loại bỏ hardcoded `INTERNAL_SERVICE_TOKEN` fallback.

### 1.14 Test Coverage 27% ⚠️ LOW

133 main / 36 test. Path tài chính chưa rõ coverage cụ thể.

**Action P0:** Path checkout + payment + inventory deduction phải ≥ 80%. Tổng ≥ 60%.

### 1.15 Promotion Engine ⚠️ PARTIAL

**File:** `services/sales-service/.../PromotionEngine.java`

**Có:** percentage, fixed_amount, min_order, BxGy, combo, subsidy. Single largest discount stack.

**Thiếu cho Highland:**
- ❌ Happy hour / time-based (no `daypart` table)
- ❌ Customer-tier targeted promo
- ❌ Channel-specific promo (Grab có promo riêng)
- ❌ Birthday auto-voucher

**Action P1:** Mở rộng rule engine LIGHT (không Drools):
```json
{
  "rule": {
    "all": [
      {"time_between": ["14:00", "17:00"]},
      {"day_of_week": ["MON","TUE","WED","THU"]},
      {"product_in": [101, 102]},
      {"customer_tier_min": "SILVER"}
    ]
  },
  "action": {"type": "discount_pct", "value": 30}
}
```
~500 LOC.

### 1.16 Statement Timeout / PgBouncer ❌ MISSING

Verify: 0 occurrence của `statement_timeout` trong migration/config.

**Action P0:**
```sql
-- migration mới
ALTER ROLE fern_app SET statement_timeout = '30s';
ALTER ROLE fern_report SET statement_timeout = '120s';
```
+ PgBouncer trước Postgres, pool_mode=transaction, max_client_conn=1000.

### 1.17 API Versioning ✅ EXISTS

Toàn bộ `/api/v1/`. Đủ cho ngày 1. Chưa cần v2 strategy giờ.

---

## 2. ROADMAP HIGHLAND-CLONE (Đã điều chỉnh sau verify)

### Sprint 1 — Production Hardening (4 tuần)
| Việc | File touch | Effort |
|---|---|---|
| Statement timeout + PgBouncer | `db/migrations/V54__db_hardening.sql`, `infra/pgbouncer/` | 0.3pm |
| Vault audit + remove hardcoded tokens | toàn bộ services bootstrap | 0.5pm |
| Test coverage path tài chính 80% | sales/inventory/finance test | 2pm |
| Stock reservation pattern | inventory-service | 1pm |
| DLT monitoring + replay endpoint | audit-service | 0.5pm |
| Cash movement ledger | `V55__cash_movement.sql` + sales-service | 1pm |

**Total: ~5.3 person-month, 4 tuần với 3 BE.**

### Sprint 2 — VN Compliance & Payment (5 tuần)
| Việc | Effort |
|---|---|
| Hóa đơn điện tử VN (Viettel hoặc VNPT) | 1pm |
| VietQR + Payoo gateway | 1pm |
| MoMo adapter | 0.5pm |
| ZaloPay adapter | 0.5pm |
| Modifier-aware recipe + inventory deduction | 1pm |

**Total: ~4pm, 5 tuần với 2 BE.**

### Sprint 3 — Customer & Loyalty (4 tuần)
| Việc | Effort |
|---|---|
| `crm.customer` + OTP + PDPL flows | 1.5pm |
| Points ledger + earn/redeem | 1pm |
| Phone verification (SMS gateway VN) | 0.5pm |
| Right-to-erasure flow | 0.3pm |
| Birthday voucher auto | 0.2pm |

**Total: ~3.5pm.**

### Sprint 4 — Channel & Edge polish (5 tuần)
| Việc | Effort |
|---|---|
| GrabFood adapter + webhook idempotency | 1.5pm |
| ShopeeFood adapter | 1pm |
| Be Food adapter | 1pm |
| Catalog manifest signing (Ed25519) | 0.3pm |
| Dexie TTL sweeper + storage warning | 0.3pm |
| Bar Display (200 LOC React WS) | 0.3pm |
| Promotion: happy hour + tier rule engine | 1pm |

**Total: ~5.4pm.**

### Sprint 5 — Pilot & Scale (6 tuần)
| Việc | Exit |
|---|---|
| Helm + Terraform | Deploy 1-click staging |
| Load test k6 200 TPS/store × 10 store | p95 < 200ms |
| Pen-test cơ bản | No critical/high |
| Per-POS dashboard | HQ realtime view |
| Pilot 3 store (mặt phố + TTTM + văn phòng) | 4 tuần soak, <0.1% sale fail |
| Rollout 10 store/tuần | Zero rollback 4 tuần |

**Total: ~6pm.**

### Tổng effort thực tế

| Phase | Effort |
|---|---|
| Sprint 1 | 5.3 |
| Sprint 2 | 4 |
| Sprint 3 | 3.5 |
| Sprint 4 | 5.4 |
| Sprint 5 | 6 |
| Buffer (UAT + đào tạo + bug fix sau pilot) | 4 |
| **Tổng** | **~28 person-month** |

**Calendar:** ~7-8 tháng với team 4-5 người.

---

## 3. RỦI RO RANKED (sau verify)

| # | Risk | Sev | Verified evidence |
|---|------|-----|-------------------|
| 1 | Modifier không trừ kho riêng | High | inventory_transaction thiếu modifier_option_id |
| 2 | Lock contention SKU hot peak 7-9h | High | FOR UPDATE only, no reservation pattern |
| 3 | Single-DB blast radius | High | Row-level + no statement_timeout |
| 4 | Test coverage 27% | High | 36/133 files |
| 5 | Channel + Loyalty thiếu = mất 30-40% doanh thu | Critical (business) | 0 implementation |
| 6 | E-invoice CQT chưa sync = không bán hợp pháp | Critical (legal) | cqt_status='internal_only' |
| 7 | Vault chưa wire thực | High | Config only, code chưa verify |
| 8 | Catalog manifest không sign | Medium | MITM risk edge |
| 9 | Dexie unbounded | Medium | No TTL sweep |
| 10 | DLT message không ai monitor | Medium | DLT có nhưng no replay tooling |

---

## 4. CHECKLIST PRODUCTION READINESS (cập nhật sau verify)

| Hạng mục | v1 | v2 sau verify |
|---|---|---|
| Multi-outlet scope isolation | ✅ | ✅ |
| Outbox + Idempotency | ✅ | ✅ |
| Modifier system | ❓ | ✅ |
| Catalog versioning | ❌ | ✅ |
| Server-authoritative time | ❌ | ✅ |
| Lock ordering ASC | ❓ | ✅ |
| OpenTelemetry | ❌ | ✅ wired |
| API versioning | ❌ | ✅ /v1/ |
| Promotion engine | ❌ | ⚠️ partial |
| E-invoice nội bộ | ❓ | ✅ |
| Recipe/BOM | ✅ | ✅ |
| DLQ coverage | ⚠️ | ✅ 4/4 |
| Vault wired | ⚠️ | ⚠️ config only |
| Test coverage ≥60% | ❌ | ❌ 27% |
| Modifier-aware inventory | ❓ | ❌ |
| Channel adapters | ❌ | ❌ |
| Loyalty/CRM | ❌ | ❌ |
| VN payment (VietQR/MoMo/...) | ❌ | ❌ |
| E-invoice CQT sync | ❌ | ❌ |
| Cash movement ledger | ❓ | ⚠️ partial |
| Stock reservation pattern | ❌ | ❌ |
| Statement timeout + PgBouncer | ❌ | ❌ |
| Catalog manifest signing | ❌ | ❌ |
| Dexie TTL automatic | ❌ | ❌ |
| Happy hour / time-based promo | ❌ | ❌ |
| K8s/IaC | ❌ | ❌ |
| Pen-test | ❌ | ❌ |
| Load test artifacts | ❌ | ❌ |

---

## 5. KHUYẾN NGHỊ ƯU TIÊN

### P0 — Phải làm trước go-live

1. Modifier-aware recipe + inventory deduction
2. Stock reservation pattern (peak hour)
3. Statement timeout + PgBouncer
4. Test coverage path tài chính ≥ 80%
5. Vault thực sự wire + remove hardcoded tokens
6. Cash movement ledger + force reconciliation
7. Hóa đơn điện tử CQT sync (Viettel/VNPT)
8. VietQR (P0 cho VN)
9. Customer + loyalty MVP + PDPL consent
10. Channel adapters (ít nhất GrabFood)

### P1 — Trong 6 tháng đầu vận hành

- Catalog manifest signing
- Dexie TTL sweeper
- Happy hour / tier rule engine
- DLT monitoring + replay UI
- ShopeeFood + Be Food adapters
- MoMo + ZaloPay adapters
- Helm + Terraform IaC
- Per-POS dashboard
- Bar Display
- Cross-outlet reporting đầy đủ

### P2 — Phase 2

- Card payment + PCI-DSS
- Multi-region DR
- ML demand forecast
- KDS đầy đủ (nếu mở rộng sang bếp)
- Tier loyalty (Silver/Gold/Platinum)
- A/B test menu engine

---

## 6. KẾT LUẬN

Sau verify thực tế, FERN **vững hơn dự đoán**: modifier, catalog version, DLQ, OTEL, lock order, server time, e-invoice nội bộ, promotion engine — đều đã có. Code chất lượng tốt theo pattern tier-1.

**Khoảng cách ngắn hơn v1 đánh giá.** Không phải build từ đầu nhiều thứ — chủ yếu wire compliance VN (CQT, payment, PDPL) + thêm Channel/Loyalty (business essential cho đồ uống) + production hardening (timeout, reservation, test coverage).

**Effort thực tế: ~28 person-month, 7-8 tháng calendar, team 4-5 người.**

Pilot 3 store (mặt phố + TTTM + văn phòng) đủ tín hiệu trước rollout.

**Đừng làm:**
- KDS phức tạp (dùng Bar Display 200 LOC)
- Drools (rule engine LIGHT đủ)
- Multi-region (1 region AZ-redundant đủ ngày 1)
- Sub-recipe nested (đồ uống không cần)
- Yield management (đồ uống không cần)
- Card payment Phase 1 (cash + QR + ví đủ)

---

*Verified refs:* [V16](db/migrations/V16__product_variants_modifiers.sql), [V38](db/migrations/V38__internal_invoice.sql), [V39](db/migrations/V39__hub_register_sales_detail.sql), [SyncService.java](services/sales-service/src/main/java/com/fern/services/sales/application/SyncService.java), [PaymentStateMachine.java](services/sales-service/src/main/java/com/fern/services/sales/application/PaymentStateMachine.java), [PromotionEngine.java](services/sales-service/src/main/java/com/fern/services/sales/application/PromotionEngine.java), [InventoryEventConsumer.java](services/inventory-service/src/main/java/com/fern/services/inventory/application/InventoryEventConsumer.java).
