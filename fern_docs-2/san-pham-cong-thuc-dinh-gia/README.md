# 📂 Module: Sản phẩm, Công thức & Định giá

**Service:** `product-service` ([services/product-service](../../services/product-service))
**Frontend:** [frontend/src/components/catalog/](../../frontend/src/components/catalog)
**Base API:** `/api/v1/product`

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-CAT-001 | Quản lý danh mục sản phẩm & nguyên liệu | [quan-ly-danh-muc-san-pham.md](./quan-ly-danh-muc-san-pham.md) |
| UC-CAT-002 | Thiết lập công thức (recipe) | [thiet-lap-cong-thuc.md](./thiet-lap-cong-thuc.md) |
| UC-CAT-003 | Định giá bán | [dinh-gia-ban.md](./dinh-gia-ban.md) |
| UC-CAT-004 | Xuất bản menu (publish) | [xuat-ban-menu.md](./xuat-ban-menu.md) |

## Bảng DB

`product`, `item`, `product_variant`, `product_price`, `recipe`, `recipe_item`, `product_outlet_availability`, `menu`, `menu_category`, `menu_item`, `channel`, `daypart`, `modifier_group`, `modifier_option`, `publish_version`, `publish_item`.

## Role chủ đạo

- `region_manager` giữ quyền `product.catalog.write` (governance catalog theo region).
- `admin` không có write catalog vận hành (§8.1 admin governance-only).
