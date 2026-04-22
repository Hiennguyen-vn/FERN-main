# 📂 Module: Thu mua

**Service:** `procurement-service` ([services/procurement-service](../../services/procurement-service))
**Frontend:** [frontend/src/components/procurement/](../../frontend/src/components/procurement)
**Base API:** `/api/v1/procurement`

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-PROC-001 | Tạo đơn mua (PO) | [tao-don-mua-po.md](./tao-don-mua-po.md) |
| UC-PROC-002 | Ghi nhận hàng nhập (GR) | [ghi-nhan-hang-nhap-gr.md](./ghi-nhan-hang-nhap-gr.md) |
| UC-PROC-003 | Hoá đơn NCC (three-way match) | [hoa-don-ncc.md](./hoa-don-ncc.md) |
| UC-PROC-004 | Quản lý nhà cung cấp | [quan-ly-nha-cung-cap.md](./quan-ly-nha-cung-cap.md) |

## Bảng DB

`purchase_order`, `purchase_order_item`, `goods_receipt`, `goods_receipt_item`, `goods_receipt_transaction`, `supplier_procurement`, `supplier_invoice`, `supplier_invoice_item`, `supplier_payment`, `supplier_payment_allocation`.

## Liên module

- GR posted → inventory-service (`inventory_transaction`, `stock_balance`).
- Invoice approved → finance-service (`expense_inventory_purchase`).
- Payment → xem UC-FIN-001.
