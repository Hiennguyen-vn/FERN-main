# 01 — Market Research: POS + ERP Systems

Tổng hợp kiến trúc offline của POS thương mại + ERP lớn, rút pattern áp dụng cho FERN.

## POS Systems

### Square POS

- **Storage**: encrypted queue local trên mobile/tablet.
- **Payment offline**: Store-and-Forward — approve tại terminal không verify issuer. Merchant 100% chịu risk declined/chargeback/expired.
- **Client ID**: `client_transaction_id` do client sinh để lookup sau merge.
- **Floor limit** offline configurable (giảm exposure).
- **April 2026**: bật offline mặc định mọi device.
- **Áp dụng FERN**: snowflake event_id ≈ `client_transaction_id`. Cash-only scope FERN → không gánh card risk.

Refs: [Square Offline Mode Dev Docs](https://developer.squareup.com/docs/pos-api/cookbook/offline-mode) · [Square Mobile Payments SDK](https://developer.squareup.com/docs/mobile-payments-sdk/android/offline-payments)

### Toast POS (F&B — match use-case FERN nhất)

- **3 chế độ**:
  1. Online — mọi device → Toast cloud.
  2. **Offline with Local Sync** — 1 device làm **local hub** LAN, các POS/KDS/printer sync qua hub.
  3. Offline thuần — mỗi device tự chạy khi cả LAN mất.
- Hub auto-assigned, không user control.
- Nếu hub chết → fallback offline thuần.
- **Áp dụng FERN**: scope 1 POS/outlet = Toast mode 3 (offline thuần). Không cần hub. Nếu tương lai nhiều terminal → mode 2.

Refs: [Toast Offline Local Sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html) · [Toast Offline Overview](https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html)

### Shopify POS

- Local cache product/price/inventory/customer history.
- Auto sync khi reconnect.
- **Khuyến cáo**: hạn chế edit inventory offline — thừa nhận inventory conflict khó resolve.
- **Áp dụng FERN**: FERN dùng append-only ledger + idempotency → an toàn hơn Shopify về inventory consistency.

Ref: [Shopify POS Offline Features](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-features)

### Microsoft Dynamics 365 Commerce (enterprise multi-tier)

- **Commerce Data Exchange (CDX)**: engine sync master data → channel với **filter** theo channel. Không push full master tới mọi store.
- **Mỗi store 2 DB**:
  - Channel DB: online.
  - Offline DB: fallback khi Commerce Scale Unit unreachable.
- Store Commerce app tự switch channel ↔ offline DB.
- Scheduler distribute master data.
- Transaction offline upload lên Scale Unit khi online.
- **Áp dụng FERN**: CDX filter pattern ≈ endpoint `/sync/pull/catalog?outlet_id`. Dual-DB overkill cho scope FERN 1 POS; 1 IndexedDB đủ.

Refs: [D365 Offline Considerations](https://learn.microsoft.com/en-us/dynamics365/commerce/dev-itpro/implementation-considerations-offline) · [D365 CDX](https://learn.microsoft.com/en-us/dynamics365/commerce/dev-itpro/implementation-considerations-cdx)

### Lightspeed X-Series

- Diagnostic screen hiển thị pending queue.
- Auto sync vài phút sau reconnect.
- **Áp dụng FERN**: UI "N đơn chờ sync" là best practice — bắt chước.

Ref: [Lightspeed X-Series Offline](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534272395163-Selling-in-offline-mode-in-Retail-POS-X-Series)

### Clover

- Queue-based offline; documentation ít technical detail.
- Merchant liability rõ ràng cho offline card.

## Payment Offline — Industry Standards

### Store-and-Forward vs Offline EMV vs Forced

| Model | Verify | Risk | Merchant liability |
|---|---|---|---|
| Store-and-Forward | Không verify issuer | High declined/chargeback | 100% |
| Offline EMV | Issuer risk params trong chip | Medium | Shared |
| Forced transaction | Manual override | **Very high** | 100% |

**Khuyến nghị industry**:

- Floor limit per-transaction (thường $25–100).
- Audit log mọi offline payment.
- Cash-only offline là option an toàn nhất (FERN đã lock).

Refs: [Adyen Offline Payments](https://docs.adyen.com/point-of-sale/offline-payment) · [EMV Merchant Processing During Disruptions](https://www.emv-connection.com/downloads/2016/04/Merchant-Processing-during-Communication-Disruption-FINAL-April-2016.pdf)

## Sync Engine / Framework Alternatives

| Engine | Model | Pros | Cons | FERN fit |
|---|---|---|---|---|
| **PowerSync** | Postgres ↔ SQLite client, bidirectional, managed | SDK sẵn, SOC2/HIPAA 2026, upload queue persistent | SaaS fee, vendor lock-in | Tốt, nhưng pay-to-play |
| **ElectricSQL** | Postgres → SQLite, real-time, CRDT | Open source, active-active sync | Write path dev tự làm, offline "out of scope" per docs | Không fit — cần offline write thực sự |
| **Couchbase Lite + Sync Gateway** | JSON doc store, revision-tree conflict | Built-in sync, multi-platform | Phải migrate model sang NoSQL | Không fit — FERN relational strict |
| **Tự viết** | Outbox + IndexedDB + REST | Reuse idempotency + snowflake FERN, no dependency, control 100% | Effort build + maintain | **Chọn** |

**Recommendation**: tự viết — lý do:

1. FERN đã có 70% building block (idempotency Redis+PG, snowflake app-side).
2. Scope 1 POS/outlet → không cần CRDT phức tạp.
3. Relational schema strict → Couchbase Lite bất khả.
4. Budget startup → tránh PowerSync SaaS fee.
5. Evaluate PowerSync lại khi scale >10 outlet hoặc multi-terminal.

Refs: [PowerSync](https://www.powersync.com) · [ElectricSQL Introducing Blog](https://electric-sql.com/blog/2023/09/20/introducing-electricsql-v0.6)

## ERP Systems — Data Organization

### SAP S/4HANA

- **Single HANA in-memory DB**, shared-nothing cluster distribute large tables tự động.
- **Centralized data model**, simplified từ SAP ECC (bỏ nhiều aggregate table).
- Multi-store = same DB + partitioning, không distributed DB.
- Deployment: on-prem / public cloud / private cloud / hybrid.
- **Áp dụng FERN**: pattern "single DB với partitioning thông minh" = mô hình FERN hiện tại. Bỏ qua database-per-service là chấp nhận được ở startup scale.

Refs: [SAP S/4HANA Data Model](https://blog.sap-press.com/what-is-the-new-data-model-for-sap-s4hana) · [S/4HANA Architecture Guide](https://www.redwood.com/resource/sap-s-4hana-architecture-guide/)

### Oracle NetSuite

- **Multi-Location Inventory**: item + transaction gắn `location_id`.
- POS integration ghi trực tiếp vào NetSuite central DB (real-time).
- SuitePOS extend NetSuite tới store — NetSuite = system of record.
- Không dual-DB, không edge DB. Phụ thuộc cloud mạnh.
- **Áp dụng FERN**: NetSuite model không phù hợp offline-first vì phụ thuộc cloud. Nhưng multi-location với `location_id` = FERN `outlet_id` pattern.

Refs: [NetSuite Multi-Location Inventory](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2303574.html) · [SuiteRetail POS](https://www.suiteretail.com/pages/netsuite-retail-platform)

### Odoo

- Multi-company = **single database** + row-filtered (`company_id`), access rules.
- POS là SPA browser-based, preload product/customer/pricing vào **IndexedDB** khi open session.
- Order offline lưu local, sync back khi có mạng.
- Có option multi-database nhưng không phải default.
- **Áp dụng FERN**: Odoo POS architecture ≈ target FERN muốn build. IndexedDB + preload + sync back là pattern chuẩn cho web POS.

Refs: [Odoo POS Offline](https://www.odoo.com/forum/help-1/whats-the-mechanism-of-pos-offline-283217) · [Odoo 18 POS Offline](https://www.netilligence.ae/blogs/can-odoo-18-pos-work-offline-understanding-offline-mode/)

## Microservices Database Pattern — Industry Consensus

- **Database-per-service** là goal long-term cho microservices (loose coupling, polyglot persistence).
- **Shared database** là interim pattern khi migrate monolith → microservices. Giúp transaction management đơn giản.
- Gartner: **~60% microservices project fail vì poor database decomposition**.
- Migration: "limited services share DB while others isolated" hợp lý trong giai đoạn dài.
- **Áp dụng FERN**: đang ở giai đoạn shared DB. Move sang DB-per-service khi domain boundary đã ổn định + có real pain (hiện chưa có). Offline-first không yêu cầu DB-per-service.

Refs: [Database per Service](https://microservices.io/patterns/data/database-per-service.html) · [Shared Database Pattern](https://microservices.io/patterns/data/shared-database.html) · [Monolith to Microservices Ch.4](https://www.oreilly.com/library/view/monolith-to-microservices/9781492047834/ch04.html)

## Pattern Tổng Hợp Áp Dụng FERN

| Pattern | Source | Status trong FERN |
|---|---|---|
| Client-side transaction ID | Square | Cần sửa: thêm worker-id client + snowflake client-side (G1) |
| Filtered catalog push | D365 CDX | Cần build: `/sync/pull/catalog?outlet_id&since=version` |
| Visible pending queue UI | Lightspeed | Cần build: offline banner + counter |
| Append-only inventory ledger | Industry standard + FERN | Đã có ✓ (code); cần enforce trigger (V1 cho phép UPDATE) |
| Cash-only offline pilot | Best practice | Đã lock ✓ |
| Shift-boundary reconciliation | Toast + FERN | Đã có ✓ (SalesRepository:180-191) |
| Browser IndexedDB preload | Odoo | Cần build (PWA + Dexie) |
| Transactional outbox | Microservices best practice | Cần build (G2/G3) |
| Single shared DB, row-tenant | SAP / Odoo / NetSuite | FERN đã chọn ✓ — giữ, chưa cần split |

## Anti-Pattern Tránh

- **Update qty_on_hand trực tiếp** (Shopify style warning) — FERN đã dùng ledger, giữ nguyên.
- **Force card transaction offline** (EMV HIGH RISK) — FERN đã loại.
- **Server-generated ID block offline submit** — FERN đang bị (G1), cần fix.
- **Dual-DB per store** (D365 mô hình) — overkill cho FERN scope.
- **Schema-per-company** (Odoo optional) — không cần, row-based đủ.
- **Big-bang microservices DB split** — Gartner 60% fail; FERN giữ shared là đúng giai đoạn.
