# 📂 Module: Bán hàng & POS

**Service:** `sales-service` ([services/sales-service](../../services/sales-service))
**Frontend:** [frontend/src/components/pos/](../../frontend/src/components/pos)
**Base API:** `/api/v1/sales`, `/api/v1/sales/public`

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-POS-001 | Mở phiên POS | [mo-phien-pos.md](./mo-phien-pos.md) |
| UC-POS-002 | Tạo đơn hàng POS | [tao-don-hang-pos.md](./tao-don-hang-pos.md) |
| UC-POS-003 | Thanh toán đơn POS | [thanh-toan-don-pos.md](./thanh-toan-don-pos.md) |
| UC-POS-004 | Hủy đơn POS | [huy-don-pos.md](./huy-don-pos.md) |
| UC-POS-005 | Đóng & đối soát phiên POS | [dong-phien-pos.md](./dong-phien-pos.md) |
| UC-POS-006 | Đặt hàng qua QR (public) | [dat-hang-qua-qr.md](./dat-hang-qua-qr.md) |

## Bảng DB liên quan

`pos_session`, `sale_record`, `sale_item`, `sale_item_promotion`, `sale_item_transaction`, `payment`, `promotion`, `ordering_table`.
