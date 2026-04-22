# UC-CAT-004: Xuất bản menu (Publish version)

**Module:** Sản phẩm, Công thức & Định giá
**Mô tả ngắn:** Đóng gói snapshot menu (product + variant + modifier + price) thành `publish_version` để kênh bán (POS/QR) ăn; hỗ trợ submit, review, schedule, publish, rollback.
**Phiên bản SRS:** 1.0
**Source code tham chiếu:**

- Backend: [PublishController.java](../../services/product-service/src/main/java/com/fern/services/product/api/PublishController.java)
- Backend: [MenuController.java](../../services/product-service/src/main/java/com/fern/services/product/api/MenuController.java)
- Frontend: [CatalogModule.tsx](../../frontend/src/components/catalog/CatalogModule.tsx)
- DB: `V14__catalog_menu_channel_daypart.sql`, `V15__catalog_publish_and_audit.sql`, `V18__region_manager_catalog_governance.sql`

## 1. Actors & quyền

| Actor | Role | Permission |
|-------|------|------------|
| Region Manager | `region_manager` | `product.catalog.write` |
| Superadmin | `superadmin` | inherit |

## 2. Điều kiện

- **Tiền điều kiện:** Đã có `menu` + `menu_category` + `menu_item` (qua MenuController); các product/variant/price ở trạng thái active.
- **Hậu điều kiện (thành công):** `publish_version` mới `ACTIVE` cho `(outlet, channel, daypart)`; phiên trước → `SUPERSEDED`.
- **Hậu điều kiện (thất bại):** Không thay đổi trạng thái active.

## 3. Thực thể dữ liệu

| Entity | Bảng |
|--------|------|
| Menu | `menu`, `menu_category`, `menu_item` |
| Channel / Daypart | `channel`, `daypart` |
| Publish Version | `publish_version` |
| Publish Item (snapshot) | `publish_item` |
| Exclusions | `menu_item_exclusion` |

## 4. API endpoints

### Menu (edit pre-publish)

| Method | Path | Handler |
|--------|------|---------|
| GET / POST / PUT | `/api/v1/product/menus` | `MenuController#list/create/update` |
| POST | `/api/v1/product/menus/{id}/categories` | `#addCategory` |
| POST | `/api/v1/product/menus/categories/{catId}/items` | `#addItem` |
| DELETE | `/api/v1/product/menus/items/{itemId}` | `#removeItem` |
| GET / PUT / DELETE | `/api/v1/product/menus/{id}/exclusions` | `#exclusions*` |
| GET | `/api/v1/product/channels` | `#listChannels` |
| GET | `/api/v1/product/dayparts` | `#listDayparts` |

### Publish lifecycle

| Method | Path | Handler |
|--------|------|---------|
| GET / POST | `/api/v1/product/publish/versions` | `PublishController#list / create` |
| GET | `/api/v1/product/publish/versions/{id}` | `#get` |
| GET / POST | `/api/v1/product/publish/versions/{id}/items` | `#listItems / addItem` |
| DELETE | `/api/v1/product/publish/items/{itemId}` | `#removeItem` |
| POST | `/api/v1/product/publish/versions/{id}/submit` | `#submit` (DRAFT→PENDING_REVIEW) |
| POST | `/api/v1/product/publish/versions/{id}/review` | `#review` (approve/reject) |
| POST | `/api/v1/product/publish/versions/{id}/publish` | `#publish` → ACTIVE |
| POST | `/api/v1/product/publish/versions/{id}/schedule` | `#schedule` (future activate) |
| POST | `/api/v1/product/publish/versions/{id}/rollback` | `#rollback` |
| GET | `/api/v1/product/audit-log` | `#catalogAuditLog` |

## 5. Luồng chính (MAIN)

1. RM edit menu/category/item qua MenuController.
2. RM tạo publish version: `POST /publish/versions` body `{ outletId, channelCode, daypartCode, menuId, notes }` → DRAFT.
3. RM snapshot items: `POST /publish/versions/{id}/items` (bulk hoặc từng item).
4. RM submit → `POST /submit` → `PENDING_REVIEW`.
5. Reviewer review → `POST /review` accept → `APPROVED`; reject → `DRAFT` kèm lý do.
6. Activate: `POST /publish` → version `ACTIVE`, tự động chuyển version trước cùng scope → `SUPERSEDED`.
7. (Optional) `POST /schedule` set `scheduled_for` để tự activate sau.
8. `POST /rollback` để đưa version khác về ACTIVE.

## 6. Luồng thay thế / lỗi

- **ALT-1 Schedule tương lai** — `scheduled_for` cron job auto chạy activate.
- **EXC-1 Thiếu items** khi submit → `422 PUBLISH_VERSION_EMPTY`.
- **EXC-2 Version trùng scope còn DRAFT** (chưa submit) → `409 DRAFT_EXISTS`.
- **EXC-3 Ngoài scope region** → `403`.
- **EXC-4 Rollback về version ngoài scope** → `409 ROLLBACK_NOT_ALLOWED`.

## 7. Quy tắc nghiệp vụ

- **BR-1** — Mỗi `(outlet_id, channel_code, daypart_code)` có **đúng 1** `publish_version` ACTIVE.
- **BR-2** — `publish_item` là snapshot bất biến của product/variant/price tại thời điểm publish.
- **BR-3** — Channel `QR` phải có publish version riêng; không dùng chung POS menu.
- **BR-4** — Audit `catalog_audit_log` ghi mọi transition publish_version.

## 8. State machine

Xem [STATE-MACHINES.md §11](../STATE-MACHINES.md#11-publish-version-menu).

## 9. Sequence diagram

```mermaid
sequenceDiagram
  autonumber
  actor RM as RegionMgr
  participant FE as CatalogModule
  participant S as product-service
  participant DB
  RM->>FE: tạo version
  FE->>S: POST /publish/versions (DRAFT)
  RM->>FE: thêm items
  FE->>S: POST /publish/versions/{id}/items (bulk)
  RM->>FE: submit
  FE->>S: POST /submit → PENDING_REVIEW
  RM->>FE: review approve
  FE->>S: POST /review
  RM->>FE: activate
  FE->>S: POST /publish
  S->>DB: UPDATE previous ACTIVE → SUPERSEDED; this → ACTIVE
```

## 10. Ghi chú liên module

- POS (UC-POS-002) validate product đang trong `publish_version` ACTIVE.
- Public QR (UC-POS-006) lấy menu cho channel QR.
- Audit riêng: `catalog_audit_log` (độc lập `audit_log` thường).
