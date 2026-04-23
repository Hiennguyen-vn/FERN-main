# 05 — Implementation Plan

Roadmap chi tiết dựa trên findings từ 00–04. Không code ở doc này — chỉ mô tả.

## Nguyên Tắc

1. **Tận dụng sẵn có**: idempotency, snowflake, unit_price snapshot, inventory ledger → đã có, không build lại.
2. **Lấp 12 gap** (G1–G12 trong [00-current-state.md](00-current-state.md)) theo priority.
3. **Không split DB**. Giữ shared, thêm outbox.
4. **Cash-only offline**. Card/QR online-only.
5. **1 POS/outlet**. BroadcastChannel lock.
6. **12h offline window**. JWT lease TTL 12h.
7. **Phase 0 nghiên cứu trước** — đã hoàn thành docs này.

## Phase Map

```
Phase 0  : Research docs (← đang làm)                      1-2 tuần
Phase 1  : Central Hardening                               2-3 tuần
Phase 2  : PWA Foundation                                  1-2 tuần
Phase 3  : Offline Write Path                              2-3 tuần
Phase 4  : Pilot + Hardening                               2 tuần
Phase 5+ : Multi-terminal (hub) / Warehouse — TƯƠNG LAI
```

Total MVP offline-first: ~8–12 tuần tùy team size + parallel.

---

## Phase 1 — Central Hardening

**Mục tiêu**: backend sẵn sàng nhận offline batch + event reliable.

### 1.1 Outbox Pattern

**Files**:

- Migration `db/migrations/V13__noop_placeholder.sql` (fill gap).
- Migration `db/migrations/V19__outbox.sql`:
  ```sql
  CREATE TABLE core.outbox_event (
    id bigint PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id bigint NOT NULL,
    topic text NOT NULL,
    event_key text NOT NULL,
    payload jsonb NOT NULL,
    headers jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    status text NOT NULL DEFAULT 'PENDING',
    attempt_count int NOT NULL DEFAULT 0,
    last_error text
  );
  CREATE INDEX ix_outbox_pending
    ON core.outbox_event(status, created_at)
    WHERE status = 'PENDING';
  ```
- `common/service-common/.../outbox/OutboxWriter.java` — append cùng TX.
- `common/service-common/.../outbox/OutboxRelay.java` — scheduled 1s, `SELECT FOR UPDATE SKIP LOCKED`, publish Kafka, mark PUBLISHED. Retry exponential, max 10 attempts.
- Refactor mọi `kafkaEventPublisher.publish(...)` inline → `outboxWriter.append(...)`:
  - `services/sales-service/.../application/SalesService.java:531-574`
  - `services/product-service/.../application/*` (2 sites)
  - `services/auth-service/.../application/*` (2 sites)
  - `services/org-service/.../application/*` (5 sites)
  - `services/inventory-service/.../application/InventoryService.java:223`

### 1.2 Append-Only Enforce Inventory

Migration `V22__inventory_immutable.sql`:

```sql
CREATE OR REPLACE FUNCTION prevent_inventory_transaction_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transaction is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transaction_immutable
  BEFORE UPDATE OR DELETE ON core.inventory_transaction
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_transaction_mutation();
```

Cleanup trigger `sync_stock_balance` bỏ ON UPDATE/ON DELETE handler (không bao giờ trigger sau khi immutable).

### 1.3 Device Registry + Worker-ID

Migration `V20__device_registry.sql`:

```sql
CREATE TABLE core.device_registry (
  id bigint PRIMARY KEY,
  outlet_id bigint NOT NULL REFERENCES core.outlet(id),
  device_label text NOT NULL,
  worker_id int NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_seen_at timestamptz
);
CREATE INDEX ix_device_registry_outlet ON core.device_registry(outlet_id);
```

**Endpoint mới** `POST /api/v1/devices/provision`:

- Input: `{outlet_id, device_label}`.
- Output: `{device_id, worker_id, provisioned_at}`.
- Auth: manager role.
- Allocate unique `worker_id` (0-1023, skip 0-63 reserved central).

**Sửa** `common/common-utils/.../SnowflakeIdGenerator.java`:

- Constructor nhận `workerId int` explicit (không hash hostname).
- Config `app.snowflake.worker-id` in application.yml.
- Frontend: sau provision, lưu `worker_id` vào IndexedDB `meta` store.

### 1.4 Sync Gateway Endpoints

Nhét vào `sales-service` module (không tạo service mới cho pilot).

**Files**:

- `services/sales-service/.../api/SyncController.java` (mới)
- `services/sales-service/.../application/SyncService.java` (mới)
- `services/sales-service/.../api/SyncDtos.java` (mới)

**Endpoints**:

- `POST /api/v1/sync/push`:
  ```json
  {
    "device_id": 1234,
    "events": [
      {
        "event_id": 7890,
        "type": "pos.sale.submitted",
        "occurred_at": "2026-04-21T12:34:56Z",
        "payload": { ... }
      }
    ]
  }
  ```
  Per-event `IdempotencyGuard.execute(device_id + event_id, ...)` rồi route theo `type`:
  - `pos.session.opened` → `SalesService.openPosSession(payload)`.
  - `pos.session.closed` → `SalesService.closePosSession(payload)`.
  - `pos.sale.submitted` → `SalesService.submitSale(payload)`.
  - `pos.sale.approved` → `SalesService.approveSale(payload)`.
  - `pos.payment.captured` → `SalesService.markPaymentDone(payload)`.
  Response:
  ```json
  {
    "accepted": [7890],
    "rejected": [{"event_id": 7891, "reason": "stale_price"}]
  }
  ```
- `GET /api/v1/sync/pull/catalog?since={version}&outlet_id={id}`:
  - Stream NDJSON từ `publish_version` cursor.
  - Mỗi line = 1 change record (entity_type, change_type, after_snapshot).
- `GET /api/v1/sync/manifest?outlet_id={id}`:
  - Return `{catalog_version, price_version, user_version, config_version}`.

### 1.5 Offline Token Lease

**Sửa** `services/auth-service/.../api/AuthController.java` + `AuthService.java`:

- `POST /api/v1/auth/lease-offline` (yêu cầu online, auth hiện tại):
  - Issue JWT TTL 12h + claim `offline_grace_until` = now + 12h.
  - Claim `device_id` (từ request).
- Auth filter accept token tới `offline_grace_until` kể cả khi refresh endpoint unreachable.
- Expire → 401, POS hiển thị lock screen yêu cầu reconnect.

### 1.6 Payment State Machine

Migration `V21__payment_state.sql`:

```sql
ALTER TABLE core.payment
  ADD COLUMN state text NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN offline_captured_at timestamptz,
  ADD COLUMN reconciled_at timestamptz,
  ADD COLUMN device_id bigint REFERENCES core.device_registry(id);

ALTER TABLE core.payment
  ADD CONSTRAINT chk_payment_state
  CHECK (state IN ('PENDING_OFFLINE','QUEUED','COMPLETED','RECONCILED','FAILED'));
```

**Logic**:

- Online sale → `state = 'COMPLETED'`.
- Offline sale sync: `state = 'PENDING_OFFLINE'` lúc POS tạo, server chuyển `'COMPLETED'` khi sync.
- Close shift: update tất cả payment ngày đó → `'RECONCILED'` nếu đã cash-count match.

### 1.7 Negative Balance Policy

Quyết định: **allow negative, flag báo cáo** (F&B-friendly, đã đề xuất trong [03](03-inventory-ledger-vs-snapshot.md)).

Bỏ trigger `prevent_negative_stock_balance` hoặc chuyển thành warning log. Cần user xác nhận.

---

## Phase 2 — PWA Foundation

**Mục tiêu**: frontend install-able, cache app shell + catalog, detect online/offline.

### 2.1 PWA Scaffold

**Deps**: `vite-plugin-pwa`, `workbox-window`, `dexie`.

**Files**:

- `frontend/vite.config.ts` — add VitePWA plugin.
- `frontend/public/manifest.webmanifest` — name, icons, display=standalone, theme_color.
- `frontend/public/icons/` — PWA icons (192/512 Android, 180 iOS).
- `frontend/src/offline/sw-register.ts` — register + update handler.
- `frontend/src/App.tsx` — import sw-register, init Dexie.

### 2.2 Dexie IndexedDB

`frontend/src/offline/db.ts`:

```ts
import Dexie, { Table } from 'dexie';

export class FernDB extends Dexie {
  catalog!: Table<Product, number>;
  prices!: Table<PriceEntry, [number, number]>;
  outbox!: Table<OutboxEvent, string>;
  pendingOrders!: Table<PendingOrder, string>;
  sessions!: Table<PosSessionCache, number>;
  meta!: Table<MetaKV, string>;

  constructor() {
    super('fern-pos');
    this.version(1).stores({
      catalog: 'id, outlet_id, updated_at',
      prices: '[product_id+outlet_id], effective_from',
      outbox: 'event_id, status, created_at',
      pendingOrders: 'idempotency_key, phase, created_at',
      sessions: 'id, status',
      meta: 'key',
    });
  }
}

export const db = new FernDB();
```

### 2.3 Catalog Prefetch

`frontend/src/offline/catalog-sync.ts`:

- `syncCatalog()`:
  1. GET `/sync/manifest` → so với `meta.catalog_version` Dexie.
  2. Nếu khác → GET `/sync/pull/catalog?since=<local_version>` (NDJSON stream).
  3. Parse từng line → upsert Dexie.
  4. Update `meta.catalog_version`.

Hook `useCatalogSync()` trigger:

- App mount.
- Interval 5 phút khi online.
- Event `online` listener.

### 2.4 Network Status

`frontend/src/hooks/useNetworkStatus.ts`:

- `navigator.onLine` + ping `/sync/manifest` HEAD mỗi 30s.
- Return `{online: boolean, lastPing: Date}`.

`frontend/src/components/shell/AppSidebar.tsx` — thêm banner:

- "Offline — N đơn chờ sync" (đỏ khi offline, vàng khi có pending, xanh khi all synced).

### 2.5 Migrate localStorage → Dexie

Refactor giữ API cũ, đổi storage:

- `frontend/src/routes/pos-order/hooks/use-draft-orders.ts` → Dexie `pendingOrders` table.
- `frontend/src/routes/pos-order/hooks/use-submit-order.ts` → Dexie outbox table.

Giữ semantics cũ để không vỡ UI.

---

## Phase 3 — Offline Write Path

**Mục tiêu**: POS vận hành 100% offline, flush tự động khi online.

### 3.1 Client-Side Snowflake

`frontend/src/offline/snowflake.ts`:

- Dùng lib `snowflake-id` hoặc tự implement 64-bit (timestamp 41 + worker_id 10 + seq 12).
- Worker_id load từ Dexie `meta`.
- `generateId(): bigint`.

### 3.2 Outbox Client

`frontend/src/offline/outbox.ts`:

```ts
export async function enqueue(event: OutboxEvent) {
  await db.transaction('rw', db.outbox, db.pendingOrders, async () => {
    await db.outbox.add({ ...event, status: 'PENDING' });
    if (event.type === 'pos.sale.submitted') {
      await db.pendingOrders.put(event.payload);
    }
  });
  if (navigator.onLine) flush();
}

export async function flush() {
  const pending = await db.outbox.where('status').equals('PENDING').limit(50).toArray();
  if (pending.length === 0) return;
  const resp = await api.syncPush({ device_id, events: pending });
  await db.transaction('rw', db.outbox, async () => {
    for (const id of resp.accepted) await db.outbox.delete(id);
    for (const r of resp.rejected) await db.outbox.update(r.event_id, { status: 'FAILED', error: r.reason });
  });
}
```

### 3.3 Submit Order Offline

Refactor `use-submit-order.ts`:

- Sinh `sale_id` client-side qua snowflake.
- Enqueue sequence `pos.sale.submitted` → `pos.sale.approved` → `pos.payment.captured`.
- UI show "Lưu offline, chờ sync" với ID đã gen khi offline.
- Online: flush ngay, hiển thị server response.

### 3.4 Background Sync + Fallback

- Workbox `BackgroundSyncPlugin` cho `/sync/push` POST (Chrome path).
- Fallback cho Safari/Firefox:
  - `window.addEventListener('online', flush)`.
  - `document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush())`.
  - Polling 15s khi tab active.

### 3.5 POS Session Offline

- Open shift yêu cầu online → lease session vào Dexie `sessions`.
- Sale offline attach `pos_session_id` cached.
- Close shift:
  - Frontend check: outbox empty? Nếu không → UI block + "Còn N đơn chưa sync, kết nối mạng trước".
  - Server check: outbox_event nào của device này status != PUBLISHED → 409.

### 3.6 BroadcastChannel Multi-Tab Lock

`frontend/src/offline/tab-leader.ts`:

- Elect leader qua BroadcastChannel.
- Non-leader tab → read-only mode (nút submit disable, banner "POS đang mở ở tab khác").

### 3.7 Conflict Handling (tối thiểu)

- Server idempotency guard dedup theo `event_id`.
- Catalog: server wins. `sale_item.unit_price` snapshot từ POS → server accept không override.
- Inventory: append txn. Negative balance → log warning, flag report (per policy [03](03-inventory-ledger-vs-snapshot.md)).
- Rejected events → `failedEvents` Dexie table + UI review flow.

---

## Phase 4 — Pilot + Hardening

**Mục tiêu**: 1 outlet thật vận hành 2 tuần offline-simulated.

### 4.1 Pilot Setup

- Chọn 1 outlet test.
- Provision 1 POS device qua `/api/v1/devices/provision`.
- Train staff: open shift, bán offline, close shift, recount cash.

### 4.2 Observability

- Server:
  - Metric Prometheus: outbox queue depth, publish lag, device last_seen.
  - Dashboard Grafana.
  - Alert queue depth >100 hoặc device offline >1h giờ hành chính.
- Client:
  - Sentry hoặc internal log endpoint.
  - Metric: outbox size, sync latency, failed events count.

### 4.3 Chaos Test

- Tắt mạng giữa ca → bán tiếp → bật mạng → kiểm sync đúng.
- Kill browser giữa sync → reopen → background sync replay → idempotency reject dup → 1 sale cuối cùng.
- Tắt Kafka → sale commit OK → bật lại → outbox relay publish.
- Restart Postgres → service tự reconnect, sync tiếp.

### 4.4 Load Test

- `tools/data-simulator-app/` simulate 100 sale/hour × 10h offline → 1000 event queue.
- Flush khi online → đo thời gian drain, CPU, DB load.

### 4.5 Docs & Runbook

- `docs/offline-pos/runbooks/` — incident playbook:
  - POS không sync: checklist.
  - Reconciliation variance: điều tra.
  - Rollback plan: disable PWA SW, fall back online-only.

---

## Phase 5+ Tương Lai (Ngoài Scope Pilot)

### 5.1 Multi-Terminal (Store Hub)

Khi outlet cần >1 POS cùng lúc:

- Mini-PC edge Postgres + subset services.
- Hub sync agent với central protocol cùng Phase 1 sync gateway.
- Worker-id zone riêng cho hub.

### 5.2 Warehouse (ClickHouse)

- Debezium CDC Postgres → Kafka → ClickHouse.
- dbt model fact/dim.
- Migrate report-service query sang ClickHouse.

### 5.3 Native Mobile Wrapper

- Capacitor wrap PWA → iOS app với Background Task API → giải quyết Safari iOS gap.

---

## File Changes Summary

**Migrations** (5 file mới):

- V13__noop_placeholder.sql
- V19__outbox.sql
- V20__device_registry.sql
- V21__payment_state.sql
- V22__inventory_immutable.sql

**Backend** (new):

- common/service-common/.../outbox/OutboxWriter.java
- common/service-common/.../outbox/OutboxRelay.java
- services/sales-service/.../api/SyncController.java
- services/sales-service/.../application/SyncService.java
- services/sales-service/.../api/DeviceController.java
- services/sales-service/.../application/DeviceService.java

**Backend** (modified):

- common/common-utils/.../SnowflakeIdGenerator.java (worker-id config)
- services/sales-service/.../application/SalesService.java (outbox)
- services/product-service/.../* (outbox)
- services/auth-service/.../AuthService.java (lease-offline)
- services/org-service/.../* (outbox)
- services/inventory-service/.../InventoryService.java (outbox)

**Frontend** (new):

- frontend/public/manifest.webmanifest
- frontend/public/icons/*
- frontend/src/offline/db.ts
- frontend/src/offline/outbox.ts
- frontend/src/offline/catalog-sync.ts
- frontend/src/offline/device.ts
- frontend/src/offline/snowflake.ts
- frontend/src/offline/sw-register.ts
- frontend/src/offline/tab-leader.ts
- frontend/src/hooks/useNetworkStatus.ts
- frontend/src/hooks/useCatalogSync.ts

**Frontend** (modified):

- frontend/vite.config.ts (vite-plugin-pwa)
- frontend/src/App.tsx (register SW, init Dexie)
- frontend/src/components/shell/AppSidebar.tsx (offline banner)
- frontend/src/routes/pos-order/hooks/use-draft-orders.ts (Dexie)
- frontend/src/routes/pos-order/hooks/use-submit-order.ts (outbox)

---

## Verification Checklist (End-to-End)

- [ ] Outbox E2E: sale → Kafka down → DB commit OK, outbox PENDING → Kafka up → publish → inventory apply. 1 lần.
- [ ] PWA install: Chrome install → offline → reopen → app shell OK, catalog từ Dexie, tạo order OK.
- [ ] Offline order: disable network → 3 cash sale → Dexie outbox 3 event → enable network → outbox empty <10s, central 3 sale đúng ID client.
- [ ] Browser crash: submit → kill → reopen → background sync replay → idempotency dedup → UI 1 sale.
- [ ] Catalog delta: đổi giá central → POS online trong 5 phút thấy giá mới; POS offline giữ snapshot.
- [ ] Offline token: lease 12h → tắt mạng → POS auth OK → qua grace → lock screen.
- [ ] Payment state: offline cash → PENDING_OFFLINE → sync → COMPLETED → close shift → RECONCILED.
- [ ] Close shift guard: outbox chưa empty → 409 block.
- [ ] Tab lock: mở 2 tab POS → tab 2 read-only.
- [ ] Worker-id: provision 2 device → sinh 10k ID đồng thời offline → 0 collision.
- [ ] Inventory immutable: UPDATE inventory_transaction → RAISE EXCEPTION.
- [ ] Negative balance: oversell offline → sync OK, flag warning trong report.
- [ ] Load: simulator 1000 event queue → drain <5 min, CPU <70%.

## Open Decisions Còn Chốt Với User

| # | Decision | Recommend |
|---|---|---|
| 1 | Negative balance offline: allow + flag vs block | Allow + flag (F&B) |
| 2 | Safari iOS target? | Secondary với warning fallback |
| 3 | Backend + Frontend parallel hay sequential? | Parallel Phase 1 + Phase 2 |
| 4 | V13 gap intentional hay bug? | Verify với commit history |
| 5 | Migration path: big bang cut-over hay rolling? | Rolling — 1 outlet pilot trước |
| 6 | Warehouse Phase 5 khi nào ưu tiên? | Khi OLTP chậm (>500ms query report) |

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| IndexedDB quota iOS | Cap pending 1000, evict LRU, `navigator.storage.persist()` |
| Background Sync missing Safari | Fallback polling + visibility-change + online event |
| Worker-id collision | Central provision enforce UNIQUE |
| Clock skew POS offline | NTP khuyến cáo + server reject event `occurred_at` lệch >10 min |
| User mở 2 tab | BroadcastChannel lock |
| SW cache bug | Version bump + skipWaiting + dev mode disable |
| Outbox relay down | Health check + alert; pending bình thường vì DB giữ |
| Pilot outlet reject trải nghiệm | Rollback plan sẵn, disable SW, rollout on-site training trước |

---

## Đã Trả Lời Các Câu Hỏi Gốc

1. **Kiến trúc DB phù hợp?** → Giữ shared Postgres, thêm outbox + device_registry + logical domain dần. [04](04-data-organization.md).
2. **Độ phù hợp với code hiện tại?** → 70% foundation tốt (idempotency, snowflake, ledger, unit_price snapshot). 12 gap cần vá, không có gap nào yêu cầu rewrite lớn. [00](00-current-state.md).
3. **Đề xuất cải tiến?** → Outbox pattern, PWA + Dexie, client snowflake, offline token lease, payment state machine, inventory immutable trigger. Không split DB.
4. **POS offline như thế nào?** → PWA + IndexedDB (Odoo pattern) + outbox client + sync gateway central. 1 POS/outlet, cash only, 12h lease. Phase 1→3.
5. **Market research?** → Square / Toast / Shopify / D365 / Lightspeed / ERP SAP/NetSuite/Odoo. Pattern áp dụng có mapping bảng [01](01-market-research.md). Không dùng PowerSync/ElectricSQL/Couchbase — tự viết hợp lý hơn.
