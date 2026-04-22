# 📂 Module: Kho tại outlet

**Service:** `inventory-service` ([services/inventory-service](../../services/inventory-service))
**Frontend:** [frontend/src/components/inventory/](../../frontend/src/components/inventory)
**Base API:** `/api/v1/inventory`

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-INV-001 | Xem tồn kho & ledger | [xem-ton-kho.md](./xem-ton-kho.md) |
| UC-INV-002 | Kiểm kê kho tại outlet | [kiem-ke-kho-outlet.md](./kiem-ke-kho-outlet.md) |
| UC-INV-003 | Điều chỉnh kho thủ công | [dieu-chinh-kho.md](./dieu-chinh-kho.md) |
| UC-INV-004 | Ghi nhận lãng phí (waste) | [ghi-nhan-waste.md](./ghi-nhan-waste.md) |

## Bảng DB

`stock_balance`, `inventory_transaction`, `inventory_adjustment`, `stock_count_session`, `stock_count_line`.

## Liên module

- GR (thu mua) tăng tồn qua `goods_receipt_transaction` → trigger `stock_balance`.
- Sale (POS) giảm tồn qua `sale_item_transaction`.
- Transfer kho giữa outlet: chưa có flow API riêng (verify nếu thêm sau).
