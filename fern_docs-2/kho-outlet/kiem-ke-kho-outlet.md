# UC-INV-002: Kiểm kê kho tại outlet

**Module:** Kho tại outlet
**Mô tả ngắn:** Tạo phiên kiểm kê, đếm thực tế, so với `stock_balance` hệ thống, post để sinh `inventory_adjustment` chênh lệch.
**Phiên bản SRS:** 1.0
**Source code tham chiếu:**

- Backend: [InventoryController.java](../../services/inventory-service/src/main/java/com/fern/services/inventory/api/InventoryController.java) (`/stock-count-sessions/*`)
- Frontend: [InventoryModule.tsx](../../frontend/src/components/inventory/InventoryModule.tsx) (tab Counts)

## 1. Actors & quyền

| Actor | Role | Permission |
|-------|------|------------|
| Outlet Manager | `outlet_manager` | `inventory.write` + `inventory.adjust` |
| Inventory Clerk | `inventory_clerk` | `inventory.write` (count only; adjust cần thêm quyền) |

## 2. Điều kiện

- **Tiền điều kiện:** Outlet active; user có scope; có thể có phiên POS mở (policy cấu hình — mặc định cho phép kiểm kê song song partial).
- **Hậu điều kiện (thành công):** `stock_count_session.status = POSTED`; mỗi line chênh lệch sinh `inventory_adjustment` tương ứng; `stock_balance` cập nhật.
- **Hậu điều kiện (thất bại):** Session giữ `DRAFT`/`COUNTING`/`RECONCILING`; không thay đổi stock.

## 3. Thực thể dữ liệu

| Entity | Bảng |
|--------|------|
| Count Session | `stock_count_session` |
| Count Line | `stock_count_line` |
| Adjustment | `inventory_adjustment` |
| Stock Balance | `stock_balance` |

## 4. API endpoints

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/v1/inventory/stock-count-sessions` | `InventoryController#createCountSession` |
| GET  | `/api/v1/inventory/stock-count-sessions` | `#listCountSessions` |
| GET  | `/api/v1/inventory/stock-count-sessions/{id}` | `#getCountSession` |
| POST | `/api/v1/inventory/stock-count-sessions/{id}/post` | `#postCountSession` |

## 5. Luồng chính (MAIN)

1. Actor tạo session: `{ outletId, scope: FULL|PARTIAL, itemIds[]?, note }` → `POST /stock-count-sessions` → DRAFT.
2. FE sinh `stock_count_line` cho từng item với `expectedQty` snapshot từ `stock_balance` hiện tại.
3. Actor đi đếm, nhập `countedQty`; FE update lines (có thể multi-user cùng session — mỗi line gắn `counter_id`).
4. Session chuyển `COUNTING → RECONCILING` khi submit.
5. Review diff = `countedQty - expectedQty`; actor confirm.
6. `POST /stock-count-sessions/{id}/post`:
   - Mỗi line `diff != 0` → INSERT `inventory_adjustment` (reason `STOCK_COUNT`).
   - UPDATE `stock_balance` theo diff (qua trigger).
   - UPDATE session `POSTED`.
7. Event `inventory.count.posted`.

## 6. Luồng thay thế / lỗi

- **ALT-1 Partial count** — chỉ kiểm subset items; các items không nằm trong scope không sinh adjustment.
- **ALT-2 Re-count** — RECONCILING → DRAFT để đếm lại (endpoint riêng hoặc update status).
- **EXC-1 Diff vượt ngưỡng** — `|diff| > THRESHOLD` (policy, mặc định 5% hoặc giá trị USD/VND) → cần approval Outlet Manager trước khi post → `422 COUNT_DIFF_NEEDS_APPROVAL`.
- **EXC-2 Stock âm sau post** → chặn bởi guard `V7`/`V8` → `409 STOCK_NEGATIVE_DENIED`.
- **EXC-3 Không scope outlet** → `403`.

## 7. Quy tắc nghiệp vụ

- **BR-1** — Scope count phải gắn đúng 1 outlet.
- **BR-2** — Mọi line ở trạng thái POSTED phải có `counted_by` và `counted_at`.
- **BR-3** — Adjustment sinh ra phải có `reason = STOCK_COUNT`, `source_session_id` = id session.
- **BR-4** — Sau POSTED không sửa line; muốn đảo cần session mới hoặc adjustment manual.

## 8. State machine

Xem [STATE-MACHINES.md §7](../STATE-MACHINES.md#7-stock-count-session).

## 9. Sequence diagram

```mermaid
sequenceDiagram
  autonumber
  actor M as OutletMgr/Clerk
  participant FE
  participant S as inventory-service
  participant DB
  M->>FE: tạo session
  FE->>S: POST /stock-count-sessions
  S->>DB: INSERT session(DRAFT) + lines(expectedQty)
  M->>FE: nhập countedQty
  FE->>S: (PATCH lines — nếu có endpoint; hoặc bundled tại post)
  M->>FE: submit
  FE->>S: POST /stock-count-sessions/{id}/post
  S->>DB: INSERT inventory_adjustment cho mỗi diff
  S->>DB: UPDATE stock_balance (trigger)
  S->>DB: UPDATE session POSTED
  S-->>FE: 200
```

## 10. Ghi chú liên module

- Audit: `inventory.count.*`.
- Adjustment sinh ra xem thêm UC-INV-003.
