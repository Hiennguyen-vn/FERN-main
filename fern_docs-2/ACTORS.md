# ACTORS — Ma trận Role × Permission × Module

Tham chiếu trực tiếp từ seed: `db/seeds/000_baseline_seed.sql`, `db/seeds/010_workflow_validation_seed.sql`, `db/seeds/011_role_test_accounts_seed.sql`.

## 1. Danh sách role hệ thống (9 canonical roles)

| Role code | Tên hiển thị | Phạm vi mặc định | Ghi chú |
|-----------|--------------|------------------|---------|
| `superadmin` | Superadmin | Toàn chuỗi (fan-out outlet) | Chỉ dùng emergency override |
| `admin` | Admin | Governance (IAM, Org, Audit) | §8.1: chỉ giữ 4 permission governance |
| `region_manager` | Region Manager | Nhiều outlet trong region | Giám sát vận hành + catalog |
| `outlet_manager` | Outlet Manager | Một outlet | Phê duyệt cấp outlet |
| `cashier` *(alias `staff`)* | Staff | Một outlet | POS operator |
| `procurement_officer` *(alias `procurement`)* | Procurement | Một outlet | Mua hàng |
| `finance` | Finance | Nhiều outlet (region) | Chi phí, phê duyệt lương |
| `hr` | HR | Nhiều outlet (region) | Hợp đồng, chấm công, lương |
| `kitchen_staff` | Kitchen Staff | Một outlet | Read-only, fulfillment |
| `inventory_clerk` *(legacy)* | Inventory Clerk | Một outlet | Chỉ `inventory.write` |

Scope gán qua bảng `core.user_role(user_id, role_code, outlet_id)`. Region-level = fan-out nhiều dòng outlet.

## 2. Permission codes (canonical)

| Code | Nhóm | Mô tả |
|------|------|-------|
| `auth.user.write` | IAM | Tạo/sửa user, thay đổi outlet access |
| `auth.role.write` | IAM | Sửa gán permission cho role |
| `org.write` | Org | Quản trị outlet, exchange rate |
| `audit.read` | Audit | Đọc audit log |
| `product.catalog.write` | Product | Sửa product/recipe/pricing |
| `sales.order.write` | Sales/POS | Thao tác sale, POS |
| `sale.refund` | Sales | Hoàn tiền bán hàng |
| `purchase.write` | Procurement | Tạo PO/GR/Invoice |
| `purchase.approve` | Procurement | Phê duyệt PO |
| `inventory.write` | Inventory | Ghi sản lượng kho (count, waste) |
| `inventory.adjust` | Inventory | Điều chỉnh kho thủ công |
| `hr.write` | HR | Sửa lịch ca, hợp đồng |
| `finance.write` | Finance | Ghi chi phí tài chính |

## 3. Ma trận Role × Permission (baseline)

Dấu `✔` = grant trong seed baseline; `(governance)` = giữ sau §8.1 admin cleanup.

| Permission \\ Role | superadmin | admin | region_manager | outlet_manager | cashier | procurement_officer | finance | hr | kitchen_staff | inventory_clerk |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `auth.user.write` | ✔ | ✔ (gov) | | | | | | | | |
| `auth.role.write` | ✔ | ✔ (gov) | | | | | | | | |
| `org.write` | ✔ | ✔ (gov) | | | | | | | | |
| `audit.read` | ✔ | ✔ (gov) | | | | | | | | |
| `product.catalog.write` | ✔ | | ✔ | | | | | | | |
| `sales.order.write` | ✔ | | | ✔ | ✔ | | | | | |
| `sale.refund` | ✔ | | | ✔ | | | | | | |
| `purchase.write` | ✔ | | | | | ✔ | | | | |
| `purchase.approve` | ✔ | | ✔ | ✔ | | | | | | |
| `inventory.write` | ✔ | | | ✔ | | | | | | ✔ |
| `inventory.adjust` | ✔ | | | ✔ | | | | | | |
| `hr.write` | ✔ | | | ✔ | | | | ✔ | | |
| `finance.write` | ✔ | | | | | | ✔ | | | |

> *Lưu ý:* Seed V1 (`000_baseline`) grant `admin` nhiều permission vận hành; nhưng `011_role_test_accounts_seed.sql` §8.1 chủ động DELETE các grant đó để `admin` còn đúng 4 permission governance. SRS lấy **trạng thái sau seed 011** làm chuẩn.

## 4. Ma trận Actor × Module

| Module | superadmin | admin | region_manager | outlet_manager | cashier | procurement | finance | hr | kitchen_staff |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| POS (Bán hàng) | R/W | R | R | R/W | R/W | | R | | R |
| Thu mua | R/W | R | R/W (approve) | R/W (approve) | | R/W (create) | R | | |
| Kho outlet | R/W | R | R | R/W | R | R | R | | R |
| Sản phẩm/Recipe/Giá | R/W | R | R/W | R | | | R | | R |
| Nhân sự & chấm công | R/W | R | R | R/W | R (self) | | R | R/W | R (self) |
| Tài chính/Lương | R/W | R | R | R | | | R/W | R (prep) | |
| IAM | R/W | R/W | R (scope) | | | | | | |
| Audit | R/W | R | R | R (scope) | | | R (scope) | R (scope) | |
| Tham chiếu/Tổ chức | R/W | R/W | R | R (scope) | R | R | R | R | R |

Chú thích: R = đọc, W = ghi, trống = không truy cập.

## 5. Gán scope ngoài role

- Override mức user: `core.user_permission(user_id, permission_code, outlet_id, effect)` — `GRANT`/`DENY`.
- Scope outlet cho 1 role: bản ghi `core.user_role` thêm cùng `role_code` ứng mỗi `outlet_id`.
- Region scope = fan-out outlets thuộc region (SQL seed dùng pattern này cho `region_manager`, `finance`, `hr`).

## 6. Route-level guard (frontend)

`frontend/src/auth/` (hoặc tương đương) map role → navigation menu. Public routes (`/order/:tableToken`, `/posorder`) không yêu cầu session.
