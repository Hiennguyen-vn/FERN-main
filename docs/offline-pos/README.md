# Offline-First POS — FERN

Docs cho kiến trúc POS vận hành offline, sync khi có mạng. Bộ docs này bắt đầu
từ giai đoạn research, nhưng repo hiện đã có implementation POS edge theo mô
hình mini server LAN.

## Scope Hiện Tại

| | |
|---|---|
| **Outlet device** | 1 mini server/hub tại outlet, các máy POS terminal trong LAN kết nối vào hub. |
| **Terminal auth** | User/PIN local trên mini server; browser POS không giữ central JWT. |
| **Upstream auth** | Mini server sync lên backend bằng Device JWT. |
| **Offline payment** | Cash only. Card/QR/e-wallet → online required. |
| **Offline window** | 8–12h (1 ca bán hàng). Local offline lease TTL 12h. |
| **Sync model** | Local outbox trên mini server, push lên `/api/v1/sync/push`, backend dedupe bằng `processed_events`. |

## Docs

1. **[00-current-state.md](00-current-state.md)** — Audit lịch sử trước POS edge: sale path, inventory ledger, catalog, auth, publish/outbox, gap list tại thời điểm đó.
2. **[01-market-research.md](01-market-research.md)** — Square, Toast, Shopify, Dynamics 365 Commerce, Lightspeed, Clover, PowerSync/ElectricSQL/Couchbase Lite, ERP (SAP/NetSuite/Odoo). Payment offline rủi ro EMV.
3. **[02-service-worker-cross-browser.md](02-service-worker-cross-browser.md)** — Background Sync matrix Chrome/Firefox/Safari macOS/iOS. Fallback strategy. IndexedDB quota.
4. **[03-inventory-ledger-vs-snapshot.md](03-inventory-ledger-vs-snapshot.md)** — Event sourcing vs snapshot, stock_balance cache, negative stock, backdated correction. Áp dụng vào FERN.
5. **[04-data-organization.md](04-data-organization.md)** — Shared schema vs database-per-service. So sánh FERN với SAP S/4HANA, NetSuite, Odoo, Dynamics CDX. Khuyến nghị cho FERN.
6. **[05-implementation-plan.md](05-implementation-plan.md)** — Roadmap chi tiết: Phase 0 spike → Phase 1 central hardening → Phase 2 PWA → Phase 3 offline write. File list, migrations, verification.
7. **[06-review-response.md](06-review-response.md)** — Addendum sau review: clock skew, outbox HA/retention, stock snapshot client, void/refund, catalog chunk resume, SW deferred update, observability, multi-device test, price drift clarify.
8. **[07-partitioning-and-pricing.md](07-partitioning-and-pricing.md)** — Partition monthly cho sale/payment/inventory/audit/outbox qua pg_partman + FK composite. Pricing per-outlet (bỏ daypart/channel).
9. **[08-current-implementation-overview.md](08-current-implementation-overview.md)** — Tổng quan implementation hiện có: POS edge PWA, mini server agent, local auth, Device JWT, sale offline, inventory reservation, outbox sync, backend push/pull, demo status và gap còn lại.

## Đọc theo thứ tự

- **Lãnh đạo / PM**: README + 08 + 05.
- **Backend eng**: 08 + 00 + 03 + 04 + 05.
- **Frontend/POS eng**: 08 + 02 + 05.
- **Devops / QA**: 08 + 02 + 05 + PILOT-GUIDE.

## Lưu Ý Khi Đọc

- `00-current-state.md` là audit lịch sử ở thời điểm trước khi POS edge được triển khai đầy đủ.
- `08-current-implementation-overview.md` là tài liệu nên đọc để nắm hệ thống hiện đã có gì.
- Worktree hiện có nhiều thay đổi chưa commit, đặc biệt `FERN-pos-edge/`; cần kiểm tra git status trước khi tách PR.

## Quyết định ADR cần chốt (còn open)

1. Safari iOS có phải target? (ảnh hưởng Background Sync fallback)
2. Warehouse ClickHouse vs BigQuery vs Postgres replica (Phase 5).
3. CDC Debezium vs polling outbox relay.
4. Backend + frontend phase parallel hay sequential.
5. V13 migration gap (intent hay bug).
