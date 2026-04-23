# 06 — Review Response: Addressing P0/P1/P2 Concerns

Response cho review [05-implementation-plan.md](05-implementation-plan.md). Bổ sung/làm rõ 10 điểm chưa cover đủ + clarify 4 technical detail.

## V13 Gap — Resolved

`git log --all --diff-filter=A -- 'db/migrations/V13*'` → 0 kết quả. V13 chưa từng tồn tại. Gap là **numbering skip**, không phải file mất. An toàn chạy V19+.

**Action**: skip `V13__noop_placeholder.sql` (không cần). Set `flyway.outOfOrder=false` (mặc định) vẫn OK vì không có Vn<V19 pending.

---

## P0 — Clock Skew Strategy

### Vấn đề

POS offline 12h, user chỉnh sai giờ máy → `occurred_at` lệch 12h. Server reject >10 min → **reject toàn bộ batch**.

### Giải pháp: Monotonic Clock + Server Anchor

Client-side:

```ts
// lúc online cuối cùng, server stamp current time
interface ClockAnchor {
  server_time_at_anchor: number;   // ms epoch (server)
  monotonic_at_anchor: number;     // performance.now() lúc anchor
}

function estimateEventTime(): number {
  const delta = performance.now() - anchor.monotonic_at_anchor;
  return anchor.server_time_at_anchor + delta;
}
```

- `performance.now()` là monotonic — không bị user sửa wall clock.
- Anchor refresh mỗi lần online (ping `/sync/manifest` trả thêm `server_time`).
- Event payload 2 field: `client_occurred_at` (wall clock, cho UI) + `estimated_server_time` (monotonic-based, dùng cho ordering).

Server-side:

- **Luôn stamp** `server_received_at` khi nhận event.
- Không reject theo `occurred_at`. Chỉ log warning nếu skew >10 min.
- Reporting dùng `server_received_at` làm canonical ordering. `occurred_at` chỉ để UX hiển thị "bán lúc X".

### Revised Event Schema

```json
{
  "event_id": 7890123,
  "type": "pos.sale.submitted",
  "client_occurred_at": "2026-04-21T12:34:56Z",
  "estimated_time": "2026-04-21T12:34:56.123Z",
  "monotonic_seq": 4567,
  "payload": { ... }
}
```

Server thêm `server_received_at` khi persist.

**Action**: bỏ rule "reject >10 min". Thay bằng warning log. Thêm monotonic anchor.

---

## P0 — Outbox Retention + Relay HA

### Retention

`core.outbox_event` grow vô hạn nếu không cleanup.

Migration `V23__outbox_retention.sql`:

```sql
-- scheduled job qua pg_cron hoặc app scheduler
CREATE OR REPLACE FUNCTION cleanup_outbox_published()
RETURNS void AS $$
BEGIN
  DELETE FROM core.outbox_event
  WHERE status = 'PUBLISHED'
    AND published_at < now() - interval '90 days';
END;
$$ LANGUAGE plpgsql;
```

App-side: Spring `@Scheduled(cron = "0 0 3 * * *")` chạy nightly 3AM.

Giữ 90 ngày PUBLISHED cho debug; FAILED giữ vô hạn cho manual review.

### Relay HA

Plan gốc: 1 scheduler 1s. Risk: SPOF nếu relay crash.

**Revised**:

- Run **2+ relay instances** (cùng replica của sales-service).
- Dựa vào `SELECT FOR UPDATE SKIP LOCKED` để tránh double-publish — không cần leader election.
- **Max batch size 100 event/tick** — tránh spike Kafka khi recover từ backlog.
- **Rate limit publish**: max 1000 event/sec per instance.
- Exponential backoff: attempt 1,2,4,8,16... tối đa 10 attempt → move FAILED.

### SLO Alerting

Metric Prometheus:

- `outbox_pending_depth` — gauge (SELECT COUNT WHERE status='PENDING').
- `outbox_publish_lag_seconds` — histogram (`now() - created_at` của oldest PENDING).
- `outbox_publish_rate` — counter.

Alert Grafana:

- P2: lag >30s trong 5 min.
- P1: lag >5 min trong 10 min, hoặc depth >1000.

**Action**: migration V23 + alert rules + 2 instance relay.

---

## P1 — Stock Snapshot Client-Side + Oversell Warning

### Vấn đề

F&B offline 12h, bán 100 phần nhưng kho còn 20 — user chỉ phát hiện khi sync → đã thu tiền, phải hoàn, mất uy tín.

### Giải pháp: Optimistic Local Stock Cache

Thêm Dexie table `stock_snapshot`:

```ts
interface StockEntry {
  item_id: number;
  outlet_id: number;
  qty_cached: number;       // từ server lúc sync gần nhất
  qty_reserved_local: number; // trừ mỗi sale offline (optimistic)
  last_synced_at: number;
}
```

### Flow

1. Mỗi lần online → `GET /sync/pull/stock?outlet_id=X` trả stock snapshot hiện tại.
2. Mỗi sale offline → trừ `qty_reserved_local` trong cùng Dexie TX với outbox.
3. UI hiển thị `qty_available = qty_cached - qty_reserved_local`.
4. Lúc add-to-cart: nếu `qty_available < requested` → **warning modal**:
   - "Còn {qty_available} phần (theo data cache lúc {last_synced_at}). Tiếp tục bán?"
   - User confirm → vẫn bán, flag `oversell_warning_shown=true` trong sale metadata.
   - User cancel → abort.
5. Khi sync về: server vẫn accept (policy allow + flag), nhưng UI đã warning rồi → trách nhiệm UX đã xong.

### Gotcha

- Cache drift: 12h offline, recipe tính deduction phức tạp → cache không precise.
- Mitigation: hiển thị "ước lượng" không "chính xác". Conservative: ưu tiên under-estimate để warning sớm.

**Action**: thêm Dexie table, hook `useStockSnapshot()`, modal warning. Thêm `/sync/pull/stock` endpoint ở backend.

---

## P1 — Refund/Void Event Type

### Event Types Bổ Sung

Plan gốc 5 types. Thêm:

- `pos.sale.voided` — hủy sale chưa settle (vd user đổi ý trước khi thanh toán).
- `pos.sale.refunded` — hoàn tiền sau đã thanh toán (partial hoặc full).
- `pos.inventory.adjusted` — điều chỉnh kho thủ công (compensating entry).

### Offline Void Logic

Case A: sale chưa sync → void trước sync:

1. Find event trong Dexie outbox → delete cả `pos.sale.submitted`/`approved`/`payment.captured` chain + pendingOrder.
2. Log audit `pos.sale.voided_locally` (không gửi lên server vì sale gốc chưa tồn tại).

Case B: sale đã sync → refund:

1. Enqueue event `pos.sale.refunded(sale_id, amount, reason)`.
2. Server tạo `payment` row compensating (negative amount).
3. Inventory: generate `inventory_transaction` compensating (positive qty_change).

Case C: partial sync (submit sync, approve chưa):

1. Client detect: submit đã `accepted`, approve chưa.
2. Void = refund đã-submit + cancel pending approve outbox entry.

### Server Endpoint

`POST /api/v1/sync/push` route mới trong switch:

```java
case "pos.sale.voided" -> salesService.voidSale(payload);
case "pos.sale.refunded" -> salesService.refundSale(payload);
case "pos.inventory.adjusted" -> inventoryService.adjustStock(payload);
```

**Action**: thêm 3 event type, UI void button, refund flow.

---

## P1 — Catalog NDJSON Resume Chunking

### Vấn đề

Plan 1.4 stream NDJSON từ `publish_version` cursor. Client mất kết nối ở row 30k/50k → không resume được → pull lại từ đầu.

### Giải pháp: Version Window Chunking

Server `GET /sync/pull/catalog?since={v}&limit={n}`:

- Trả max `limit` event (default 1000), incrementing version.
- Response header `X-Next-Cursor: {v_last}`.
- Response body NDJSON + trailer `{"type":"checkpoint","cursor":{v_last}}`.

Client:

```ts
async function syncCatalogChunked() {
  let cursor = await db.meta.get('catalog_cursor') ?? 0;
  while (true) {
    const resp = await fetch(`/sync/pull/catalog?since=${cursor}&limit=1000`);
    const nextCursor = resp.headers.get('X-Next-Cursor');
    await applyNdjson(resp.body);
    if (!nextCursor || nextCursor === cursor) break; // caught up
    cursor = nextCursor;
    await db.meta.put({ key: 'catalog_cursor', value: cursor }); // persist per chunk
  }
}
```

- Mỗi chunk commit cursor riêng → crash giữa chừng resume chunk đó, không pull lại từ đầu.
- Chunk 1000 event ≈ 100KB gzip → OK cho 3G.

**Action**: backend phân trang `/sync/pull/catalog`. Client commit cursor per chunk.

---

## P1 — Service Worker Update Deferral

### Vấn đề

`skipWaiting` + `clientsClaim` = user đang giữa ca bán bị force reload → mất cart, mất state.

### Giải pháp: Deferred Update

```ts
// sw-register.ts
const wb = new Workbox('/sw.js');

wb.addEventListener('waiting', async () => {
  // có version mới chờ activate
  const canUpdate = await checkIdle();
  if (canUpdate) {
    wb.messageSkipWaiting();
  } else {
    // UI banner: "Phiên bản mới sẵn sàng, cập nhật sau khi đóng ca"
    showUpdateBanner();
  }
});

async function checkIdle() {
  const outboxEmpty = (await db.outbox.count()) === 0;
  const noCart = !hasActiveCart();
  const sessionClosed = !hasOpenSession();
  return outboxEmpty && noCart && sessionClosed;
}
```

User trigger update explicitly:

- Khi close shift → prompt "Cập nhật ngay?".
- Banner có nút "Cập nhật bây giờ" (nếu user OK mất cart).

### Breaking Change Migration

- Nếu SW mới thay đổi Dexie schema → cần migration code trong `db.version(N+1).stores({...}).upgrade(tx => ...)`.
- Test Dexie upgrade path trước release.

**Action**: deferred update flow + idle check + UI banner.

---

## P1 — Observability Move to Phase 1 & 2

Plan gốc: Sentry/metrics ở Phase 4. Revised: move sớm.

### Phase 1 End

- Prometheus metrics:
  - `outbox_pending_depth`, `outbox_publish_lag_seconds`.
  - `sync_push_duration_seconds` histogram.
  - `sync_push_accepted_total`, `sync_push_rejected_total` (by reason).
  - `device_last_seen_timestamp` per outlet.
- Grafana dashboard Offline POS Health.
- Alert rules: outbox lag, device stale, rejected rate >1%.

### Phase 2 End

- Sentry frontend integration.
- Custom metrics via endpoint `POST /api/v1/telemetry`:
  - Outbox client depth.
  - Sync latency (client-measured).
  - Failed event count + reason.
  - SW activation events.
- Client log level controllable via feature flag.

### Phase 3 & 4

- Reuse infrastructure từ Phase 1-2.
- Thêm business metrics: sales/hour offline vs online, oversell flag rate.

**Action**: Prometheus Phase 1 end, Sentry Phase 2 end.

---

## P2 — 2-Device Chaos Test Trong Phase 4

Dù pilot 1 device, test boundary 2 device để phát hiện architectural bug sớm.

### Test Matrix

1. Provision 2 device cùng outlet.
2. Both open session simultaneously → expect server reject thứ 2 với 409 "session_already_open".
3. Device A bán offline, device B online → server ordering theo `server_received_at`.
4. Device A bán offline mã sản phẩm X, device B bán online X → stock decrement đúng thứ tự.
5. Refund cross-device: device A tạo sale, device B refund → event routing đúng.

Chạy trong chaos test phase 4.3, không block pilot nhưng phải pass để Phase 5 multi-terminal an toàn.

**Action**: thêm test matrix vào chaos suite.

---

## P2 — Worker-ID + Browser Fingerprint

### Vấn đề

BroadcastChannel không cross-browser. User mở Chrome + Firefox cùng máy → cùng device_id → cùng worker_id → snowflake collision.

### Giải pháp: Device Provisioning Per Browser

Option A: **Provision per browser storage**:

- Worker_id bind với `(outlet_id, browser_fingerprint_hash)`.
- Browser fingerprint = hash(userAgent + platform + languages + timezone + canvas fingerprint).
- Lưu trong IndexedDB `meta`.
- Lần đầu mở từng browser → provision mới → worker_id khác.

Option B: **Onboarding rule**:

- Document: "1 outlet = 1 browser cụ thể (Chrome khuyến cáo)".
- Detect fingerprint khác với lần provision trước → yêu cầu re-provision.
- Simpler, ít code.

Recommend Option B cho pilot (simpler). Option A nếu user phản hồi cần multi-browser.

### Worker-ID Range

Plan gốc: `outlet_id` làm worker_id. Rủi ro nếu `outlet_id` >1024.

Revised:

- `device_registry.worker_id` = counter độc lập, allocated sequential 128-1023 (reserve 0-127 cho server).
- Central luôn gen qua `device_registry.worker_id` UNIQUE constraint.
- Max 896 POS đồng thời → đủ cho pilot + scale mid-term.

**Action**: worker_id từ counter UNIQUE không phải outlet_id. Browser fingerprint check optional.

---

## Clarifications (Technical Detail)

### 1. Price Drift vs Stale Price Rejection

Plan 3.7 từ "stale_price" trong rejected list có thể gây hiểu nhầm.

**Revised terminology**:

- `price_drift` — sale offline với giá cũ, server **accept** + flag trong report. Default cho F&B.
- `stale_price_rejected` — chỉ dùng khi business explicit cấm (vd: flash sale ngắn, tăng giá mạnh). Configurable per-product flag `reject_stale_sale=true/false`.

Default `reject_stale_sale=false` → accept all.

**Action**: thêm column `product.reject_stale_sale boolean DEFAULT false`. Logic sync check flag.

### 2. Payment State — Reporting Date

Offline cash sale: bán lúc 8h, sync lúc 20h. Báo cáo doanh thu ngày nào?

**Recommend**: doanh thu tính theo `business_date` của `pos_session` (ca bán). Không theo `server_received_at`.

- Sale event carry `pos_session_id` → lookup `pos_session.business_date` → đó là ngày báo cáo.
- Reconciliation cash-count: tính theo session không theo sync time.
- Consistent với kế toán (ghi nhận lúc phát sinh nghiệp vụ).

`server_received_at` chỉ dùng cho event ordering + audit sync latency.

**Action**: báo cáo query `JOIN pos_session ON business_date`. Document rõ trong docs report-service.

### 3. Inventory Trigger Cleanup Chi Tiết

Plan 1.2 "bỏ ON UPDATE/ON DELETE handler" cần chi tiết:

```sql
-- revised sync_stock_balance trigger (INSERT only)
CREATE OR REPLACE FUNCTION sync_stock_balance()
RETURNS trigger AS $$
BEGIN
  -- chỉ handle INSERT. UPDATE/DELETE đã bị prevent_inventory_transaction_mutation block.
  INSERT INTO core.stock_balance (item_id, outlet_id, location_id, qty_on_hand, updated_at)
  VALUES (NEW.item_id, NEW.outlet_id, NEW.location_id, NEW.qty_change, now())
  ON CONFLICT (item_id, outlet_id, location_id) DO UPDATE
    SET qty_on_hand = stock_balance.qty_on_hand + NEW.qty_change,
        updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_stock_balance_trigger ON core.inventory_transaction;
CREATE TRIGGER sync_stock_balance_trigger
  AFTER INSERT ON core.inventory_transaction  -- INSERT only
  FOR EACH ROW EXECUTE FUNCTION sync_stock_balance();
```

Correction flow (đúng pattern ledger):

- Không UPDATE row cũ.
- Insert compensating entry: `qty_change = -original_qty`.
- Second insert: `qty_change = new_qty`.
- Net effect = correction.

### 4. Sync Push Batch Size Adaptive

Plan 3.2 fix 50. Revised: adaptive theo RTT.

```ts
let batchSize = 50;
async function flush() {
  const start = Date.now();
  const batch = await db.outbox.where('status').equals('PENDING').limit(batchSize).toArray();
  const resp = await api.syncPush({ device_id, events: batch });
  const rtt = Date.now() - start;

  // adaptive: fast network → bigger batch
  if (rtt < 500) batchSize = Math.min(batchSize * 2, 500);
  else if (rtt > 3000) batchSize = Math.max(batchSize / 2, 20);
}
```

Trần 500 để tránh body quá lớn (Nginx limit).

---

## Revised Priority Summary

Thêm vào [05-implementation-plan.md](05-implementation-plan.md):

| Priority | Item | Phase |
|---|---|---|
| P0 | Monotonic clock + server anchor | Phase 1.3 + Phase 3.1 |
| P0 | Outbox retention (V23 + nightly cron) | Phase 1.1 |
| P0 | Relay HA (2 instance, rate limit, batch max) | Phase 1.1 |
| P0 | SLO alerts (outbox lag, device stale) | Phase 1 end |
| P1 | Stock snapshot Dexie + oversell warning | Phase 2.2 + Phase 3 |
| P1 | Void/refund event types (3 types mới) | Phase 1.4 + Phase 3 |
| P1 | Catalog NDJSON chunk + cursor per chunk | Phase 1.4 + Phase 2.3 |
| P1 | SW deferred update | Phase 2.1 |
| P1 | Observability Phase 1 + 2 end | Phase 1, 2 |
| P2 | 2-device chaos test | Phase 4.3 |
| P2 | Worker_id UNIQUE counter + fingerprint check | Phase 1.3 |
| Clarify | Price drift vs stale_price_rejected | Document |
| Clarify | Reporting date = business_date (session) | Document |
| Clarify | Trigger cleanup INSERT-only SQL | Migration V22 |
| Clarify | Adaptive batch size | Phase 3.2 |

V13 gap: **resolved** — không cần placeholder.

## Open Decisions — Remaining

Vẫn cần user chốt trước kick-off Phase 1:

1. Safari iOS support depth? (primary / secondary / drop)
2. Negative balance: allow+flag (recommend) vs block?
3. Backend + frontend parallel hay sequential?
4. Stock cache refresh frequency: mỗi 5 phút hay mỗi catalog sync?
5. Void window: sau bao lâu từ sale thì không cho void? (vd 24h, 7 ngày)

Sau khi chốt → bắt đầu Phase 1.
