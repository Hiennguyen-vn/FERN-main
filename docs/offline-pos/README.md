# Offline-First POS Research — FERN

Research docs cho kiến trúc POS vận hành offline, sync khi có mạng.

## Locked Scope

| | |
|---|---|
| **POS per outlet** | 1 (strict). Tab thứ 2 → read-only qua BroadcastChannel lock. |
| **Offline payment** | Cash only. Card/QR/e-wallet → online required. |
| **Offline window** | 8–12h (1 ca bán hàng). JWT lease TTL 12h. |
| **Approach** | Nghiên cứu sâu trước, chưa code. |

## Docs

1. **[00-current-state.md](00-current-state.md)** — Audit mã hiện tại: sale path, inventory ledger, catalog, auth, publish/outbox, gap list.
2. **[01-market-research.md](01-market-research.md)** — Square, Toast, Shopify, Dynamics 365 Commerce, Lightspeed, Clover, PowerSync/ElectricSQL/Couchbase Lite, ERP (SAP/NetSuite/Odoo). Payment offline rủi ro EMV.
3. **[02-service-worker-cross-browser.md](02-service-worker-cross-browser.md)** — Background Sync matrix Chrome/Firefox/Safari macOS/iOS. Fallback strategy. IndexedDB quota.
4. **[03-inventory-ledger-vs-snapshot.md](03-inventory-ledger-vs-snapshot.md)** — Event sourcing vs snapshot, stock_balance cache, negative stock, backdated correction. Áp dụng vào FERN.
5. **[04-data-organization.md](04-data-organization.md)** — Shared schema vs database-per-service. So sánh FERN với SAP S/4HANA, NetSuite, Odoo, Dynamics CDX. Khuyến nghị cho FERN.
6. **[05-implementation-plan.md](05-implementation-plan.md)** — Roadmap chi tiết: Phase 0 spike → Phase 1 central hardening → Phase 2 PWA → Phase 3 offline write. File list, migrations, verification.
7. **[06-review-response.md](06-review-response.md)** — Addendum sau review: clock skew, outbox HA/retention, stock snapshot client, void/refund, catalog chunk resume, SW deferred update, observability, multi-device test, price drift clarify.
8. **[07-partitioning-and-pricing.md](07-partitioning-and-pricing.md)** — Partition monthly cho sale/payment/inventory/audit/outbox qua pg_partman + FK composite. Pricing per-outlet (bỏ daypart/channel).

## Đọc theo thứ tự

- **Lãnh đạo / PM**: README + 01 + 05.
- **Backend eng**: 00 + 03 + 04 + 05.
- **Frontend eng**: 00 + 02 + 05.
- **Devops / QA**: 02 + 05.

## Quyết định ADR cần chốt (còn open)

1. Safari iOS có phải target? (ảnh hưởng Background Sync fallback)
2. Warehouse ClickHouse vs BigQuery vs Postgres replica (Phase 5).
3. CDC Debezium vs polling outbox relay.
4. Backend + frontend phase parallel hay sequential.
5. V13 migration gap (intent hay bug).
