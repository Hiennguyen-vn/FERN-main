# GLOSSARY — Từ điển & Mapping Entity ↔ Bảng DB

Mọi entity trong SRS phải ánh xạ 1–1 với bảng thật trong `core` schema (xem `db/migrations/V1__core_schema.sql` và các migration sau).

## 1. Thuật ngữ Việt ↔ Anh

| Tiếng Việt | English | Mã/Code |
|------------|---------|---------|
| Vùng | Region | `region` |
| Cửa hàng | Outlet | `outlet` |
| Phiên POS | POS Session | `pos_session` |
| Đơn bán | Sale Record / Sale Order | `sale_record` |
| Hoàn tiền | Refund | — |
| Khuyến mãi | Promotion | `promotion` |
| Sản phẩm | Product | `product` |
| Nguyên liệu | Item / Ingredient | `item` |
| Công thức | Recipe | `recipe` |
| Giá bán | Product Price | `product_price` |
| Biến thể | Variant | `product_variant` |
| Modifier (topping) | Modifier Option | `modifier_option` |
| Thực đơn | Menu | `menu` |
| Kênh bán | Channel | `channel` |
| Khung giờ | Daypart | `daypart` |
| Phiên bản xuất bản | Publish Version | `publish_version` |
| Phiếu nhập (GR) | Goods Receipt | `goods_receipt` |
| Đơn mua (PO) | Purchase Order | `purchase_order` |
| Nhà cung cấp | Supplier | `supplier_procurement` |
| Hoá đơn NCC | Supplier Invoice | `supplier_invoice` |
| Thanh toán NCC | Supplier Payment | `supplier_payment` |
| Tồn kho | Stock Balance | `stock_balance` |
| Giao dịch kho | Inventory Transaction | `inventory_transaction` |
| Điều chỉnh kho | Inventory Adjustment | `inventory_adjustment` |
| Phiên kiểm kê | Stock Count Session | `stock_count_session` |
| Dòng kiểm kê | Stock Count Line | `stock_count_line` |
| Nhân viên | Employee | `hr_employee` |
| Ca làm | Shift | `shift` |
| Phân ca | Work Shift | `work_shift` |
| Hợp đồng lao động | Employment Contract | `employment_contract` |
| Kỳ lương | Payroll Period | `payroll_period` |
| Bảng lương | Payroll | `payroll` |
| Chi phí vận hành | Operating Expense | `expense_operating` |
| Chi phí khác | Other Expense | `expense_other` |
| User | App User | `app_user` |
| Vai trò | Role | `role` |
| Quyền | Permission | `permission` |
| Phiên đăng nhập | Auth Session | `auth_session` |
| Tiền tệ | Currency | `currency` |
| Tỷ giá | Exchange Rate | `exchange_rate` |
| Nhật ký kiểm toán | Audit Log | `audit_log` |

## 2. Mapping Entity → Service → Bảng

| Entity | Service | Bảng chính |
|--------|---------|------------|
| Outlet | org-service | `outlet`, `region` |
| Currency / ExchangeRate | org-service | `currency`, `exchange_rate` |
| ServiceInstance / Rollout | master-node | `service_instance`, `service_config_profile`, `service_rollout` |
| AppUser / Role / Permission | auth-service | `app_user`, `role`, `permission`, `user_role`, `user_permission`, `role_permission`, `auth_session` |
| Product / Recipe / Price | product-service | `product`, `item`, `recipe`, `recipe_item`, `product_price`, `product_variant`, `product_outlet_availability` |
| Menu / Publish | product-service | `menu`, `menu_category`, `menu_item`, `channel`, `daypart`, `modifier_group`, `modifier_option`, `publish_version`, `publish_item` |
| StockBalance / Tx / Count | inventory-service | `stock_balance`, `inventory_transaction`, `inventory_adjustment`, `stock_count_session`, `stock_count_line` |
| PO / GR / Supplier / Invoice / Payment | procurement-service | `purchase_order`, `purchase_order_item`, `goods_receipt`, `goods_receipt_item`, `goods_receipt_transaction`, `supplier_procurement`, `supplier_invoice`, `supplier_invoice_item`, `supplier_payment`, `supplier_payment_allocation` |
| POS Session / Sale / Payment / Promotion | sales-service | `pos_session`, `sale_record`, `sale_item`, `sale_item_promotion`, `sale_item_transaction`, `payment`, `promotion` |
| Customer (CRM) | sales-service | `customer` (+ last-order views) |
| Employee / Shift / Contract | hr-service | `hr_employee`, `shift`, `work_shift`, `employment_contract`, `shift_role_requirement` |
| Payroll | payroll-service | `payroll`, `payroll_period`, `payroll_timesheet` |
| Expense | finance-service | `expense_operating`, `expense_other`, `expense_payroll`, `expense_inventory_purchase` |
| AuditLog | audit-service | `audit_log`, `catalog_audit_log` |

## 3. Ký hiệu mã use case

`UC-<MODULE>-<NNN>` — MODULE tắt 3–4 ký tự:

| Module | Prefix |
|--------|--------|
| POS / Bán hàng | `POS` |
| Thu mua | `PROC` |
| Kho outlet | `INV` |
| Sản phẩm/Recipe/Giá | `CAT` |
| Nhân sự/Chấm công | `HR` |
| Tài chính/Lương | `FIN` |
| IAM | `IAM` |
| Audit | `AUD` |
| Tham chiếu/Tổ chức | `ORG` |
