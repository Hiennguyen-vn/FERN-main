# 03 — Inventory: Ledger vs Snapshot

FERN đã dùng pattern ledger (event-sourced-like) cho inventory. Doc này phân tích depth + gap + khuyến nghị.

## 2 Mô Hình Inventory

### A. Snapshot (Direct Update)

```sql
UPDATE stock_balance SET qty_on_hand = qty_on_hand - 5 WHERE item_id = ? AND outlet_id = ?;
```

- Đơn giản, 1 row per (item × outlet).
- Write contention khi nhiều terminal cùng bán SKU.
- Mất history — không biết "trước lúc bán là bao nhiêu".
- Không thể replay, không audit trail.
- Shopify style — đó là lý do Shopify warn "đừng edit inventory offline".

### B. Ledger (Append-Only Events)

```sql
INSERT INTO inventory_transaction
  (id, item_id, outlet_id, qty_change, txn_type, source_id, txn_time)
VALUES (..., -5, 'SALE', sale_id, now());
```

- Mỗi thay đổi = 1 row mới. Historical truth.
- Stock hiện tại = SUM(qty_change) hoặc maintain qua trigger/projection.
- Audit trail tự nhiên.
- Append-only tránh write contention.
- Có thể rewind/replay để recompute balance.
- Giống nguyên lý kế toán (debit/credit, general ledger).

Refs: [Azure Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) · [Event Sourcing & Accounting History](https://dev.to/dealeron/event-sourcing-and-the-history-of-accounting-1aah) · [Kurrent Snapshots](https://www.kurrent.io/blog/snapshots-in-event-sourcing)

## Vai Trò Của Snapshot trong Ledger

- Snapshot ≠ source of truth. Source = event stream.
- Snapshot là **optimization**: tránh replay N event mỗi query.
- Regenerate snapshot bất cứ lúc nào từ stream.
- Retention: giữ snapshot mới nhất + stream từ snapshot đó trở đi.

## Hiện Trạng FERN

### Event Stream

- `core.inventory_transaction` — append-only (app convention).
- Insert qua `services/inventory-service/.../InventoryRepository.java` `applySaleCompleted()`.
- **Không có UPDATE/DELETE trong code Java hiện tại** (grep đã xác nhận).

### Snapshot (Cache)

- `core.stock_balance` — 1 row per (item × outlet × location) giữ `qty_on_hand`.
- **Maintained qua trigger** `sync_stock_balance` ([V1__core_schema.sql:308-352](../../db/migrations/V1__core_schema.sql)).
- Trigger hỗ trợ INSERT/UPDATE/DELETE trên inventory_transaction → reverse delta cũ, apply delta mới.
- V8 trigger `prevent_negative_stock_balance` block update nếu kết quả < 0.

### Gap

**G10 (từ 00-current-state.md)**: Trigger cho phép UPDATE/DELETE `inventory_transaction`. Dù code hiện không UPDATE, future dev có thể vô ý. Risk double-reverse balance.

**Mitigation đề xuất**: thêm trigger `BEFORE UPDATE OR DELETE ON inventory_transaction` RAISE EXCEPTION — cưỡng bức append-only ở DB level.

```sql
CREATE OR REPLACE FUNCTION prevent_inventory_transaction_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transaction is append-only; use compensating entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transaction_immutable
  BEFORE UPDATE OR DELETE ON core.inventory_transaction
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_transaction_mutation();
```

Khi đó phải **xóa ON UPDATE / ON DELETE handler** trong `sync_stock_balance` vì không bao giờ trigger → giảm complexity.

## Scenario Offline-First

### Normal: 1 POS bán online

1. Sale submit → sales-service tx commit → `SaleCompletedEvent` Kafka.
2. Inventory consumer apply → INSERT `inventory_transaction(qty_change = -qty)`.
3. Trigger tự update `stock_balance`.

### Offline: POS bán mất mạng

1. POS ghi `pendingSale` + `outboxEvent(type='pos.sale.submitted')` vào IndexedDB.
2. POS **không** apply inventory local — giữ stock_balance cache offline chỉ để hiển thị UI gợi ý, tính toán optimistic.
3. Khi online: flush outbox → sales-service submit → inventory consumer apply như normal.

**Optimistic local UI**: có thể trừ mentally trong IndexedDB để hiển thị "còn X" cho POS user, nhưng **server recompute khi sync** — source of truth ở server ledger.

### Conflict: sale offline → giá/stock đã đổi

- Giá: `sale_item.unit_price` đã snapshot lúc POS tạo sale offline → server accept theo giá POS gửi (không override).
- Stock: POS offline không biết stock real. Nếu server apply dẫn đến negative balance:
  - Trigger `prevent_negative_stock_balance` raise exception.
  - Consumer idempotency key ghi failure.
  - Flag sale cho staff review: "bán vượt stock, cần điều chỉnh".

**Alternative**: cho phép negative balance tạm, flag báo cáo — phù hợp F&B hơn (F&B ít khi stock cứng).

## Backdated Corrections

- Không UPDATE sale cũ → insert `inventory_adjustment` event với `txn_type = 'ADJUST'`, reference sale gốc.
- Compensating entry — giống kế toán debit/credit.

## Recompute Balance (Disaster Recovery)

Khi nghi ngờ `stock_balance` drift khỏi ledger:

```sql
INSERT INTO core.stock_balance (item_id, outlet_id, qty_on_hand)
SELECT item_id, outlet_id, SUM(qty_change)
FROM core.inventory_transaction
GROUP BY item_id, outlet_id
ON CONFLICT (item_id, outlet_id) DO UPDATE
  SET qty_on_hand = EXCLUDED.qty_on_hand;
```

- Chạy từ maintenance script `db/scripts/recompute-stock.sh`.
- Chạy sau incident, chạy định kỳ weekly để detect drift.

## Periodic Snapshot (Optimization khi stream lớn)

Hiện FERN chưa cần — stock_balance cache đã là snapshot real-time. Khi scale >10M inventory_transaction row/outlet:

- Thêm `stock_balance_snapshot_daily(item_id, outlet_id, date, qty_closing)`.
- Query stock tại thời điểm cũ = closing của ngày X + sum events từ ngày X đến now.

Để sau khi có volume thực tế.

## Read Model / Projection (Tương lai)

- Report-service có thể subscribe Kafka `fern.inventory.*` → build projection riêng (ClickHouse) → query báo cáo không đụng OLTP.
- CQRS: write = ledger Postgres; read = projection warehouse.
- Chưa cần ngay cho FERN scope pilot.

## Kết Luận & Action

| Action | Priority |
|---|---|
| Giữ mô hình ledger hiện tại | ✓ đã đúng |
| Thêm trigger `prevent_inventory_transaction_mutation` (append-only enforcement DB level) | P1 |
| Xóa ON UPDATE / ON DELETE handler trong `sync_stock_balance` | P1 (sau khi thêm trigger trên) |
| Recompute script `recompute-stock.sh` | P2 |
| Negative balance policy: allow + flag (F&B friendly) hay block? | Cần quyết định |
| Daily snapshot table | P3 — khi volume thật sự lớn |
| CQRS projection ra warehouse | P4 — khi report chậm |

## Negative Balance — Quyết Định Cần Chốt

2 lựa chọn:

**A. Strict**: block sale nếu stock = 0 (trigger raise). POS offline không biết → khi sync bị reject → UI manual resolve.

**B. Soft**: cho negative, flag báo cáo. Staff điều chỉnh sau ca. F&B-friendly.

Recommend: **B** cho pilot. F&B có lãng phí/hao hụt, stock thường không chính xác tuyệt đối. Strict gây nghẽn trải nghiệm bán hàng.

Cần user xác nhận trước khi implement.
