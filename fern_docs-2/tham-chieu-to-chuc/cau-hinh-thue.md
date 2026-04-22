# UC-ORG-004: Cấu hình thuế

**Module:** Tham chiếu & Tổ chức
**Mô tả ngắn:** Set tax code + rate theo region/outlet; dùng tính thuế khi POS tạo order và khi import supplier invoice.
**Phiên bản SRS:** 1.0
**Source code tham chiếu:**

- Frontend: [TaxSetupModule.tsx](../../frontend/src/components/finance/TaxSetupModule.tsx)
- Backend: verify — thuế hiện config qua `region.tax_code` và table tương ứng (tax_rate nếu có).

## 1. Actors & quyền

| Actor | Role | Permission |
|-------|------|------------|
| Finance | `finance` | `finance.write` |
| Admin | `admin` | `org.write` |

## 2. Thực thể dữ liệu

| Entity | Bảng |
|--------|------|
| Tax Code | `region.tax_code` + `tax_rate` (nếu có) |

## 3. Luồng chính (MAIN)

1. Actor mở Tax Setup.
2. Cấu hình `{ taxCode, ratePercent, region|outlet scope, effectiveFrom }`.
3. API lưu (verify endpoint).

## 4. Quy tắc nghiệp vụ

- **BR-1** — `rate ≥ 0`.
- **BR-2** — POS tính thuế snapshot vào `sale_item.tax_amount` tại thời điểm POSTED.
- **BR-3** — Thuế VN mặc định 8%/10% (cấu hình chuyên biệt).

## 5. Ghi chú

- Cần xác nhận bảng DB (hiện có `region.tax_code` nhưng rate chưa tách bảng — verify).
