# FERN — SRS (Software Requirements Specification)

Tài liệu đặc tả nghiệp vụ hệ thống FERN ERP, viết theo chuẩn use-case, song hành với source code hiện tại.

Mỗi use case bám sát:
- Controller backend tương ứng (dưới `services/<svc>/`)
- Module frontend tương ứng (dưới `frontend/src/components/<domain>/`)
- Bảng/migration Flyway (dưới `db/migrations/`)

## Chỉ mục module

| # | Module | Thư mục | Service backend |
|---|---|---|---|
| 1 | Bán hàng & POS | [ban-hang-pos/](./ban-hang-pos) | `sales-service` |
| 2 | Thu mua | [thu-mua/](./thu-mua) | `procurement-service` |
| 3 | Kho tại outlet | [kho-outlet/](./kho-outlet) | `inventory-service` |
| 4 | Sản phẩm, Công thức & Định giá | [san-pham-cong-thuc-dinh-gia/](./san-pham-cong-thuc-dinh-gia) | `product-service` |
| 5 | Nhân sự & Chấm công | [nhan-su-cham-cong/](./nhan-su-cham-cong) | `hr-service` |
| 6 | Tài chính & Lương | [tai-chinh-luong/](./tai-chinh-luong) | `finance-service`, `payroll-service` |
| 7 | IAM | [iam/](./iam) | `auth-service` |
| 8 | Audit & Traceability | [audit-traceability/](./audit-traceability) | `audit-service` |
| 9 | Tham chiếu & Tổ chức | [tham-chieu-to-chuc/](./tham-chieu-to-chuc) | `org-service` |

## Tài liệu hỗ trợ

- [Plan.md](./Plan.md) — kế hoạch biên soạn & cập nhật bộ SRS.
- [TEMPLATE.md](./TEMPLATE.md) — template chuẩn cho mỗi use case.
- [GLOSSARY.md](./GLOSSARY.md) — từ điển Việt–Anh + mapping entity ↔ bảng DB.
- [ACTORS.md](./ACTORS.md) — ma trận Actor × Module × Permission.
- [INTER-MODULE-FLOWS.md](./INTER-MODULE-FLOWS.md) — luồng nghiệp vụ xuyên module.
- [STATE-MACHINES.md](./STATE-MACHINES.md) — sơ đồ trạng thái các thực thể chính.

## Kiến trúc tổng quan

Kiến trúc microservice đi qua gateway, xem chi tiết ở [`../docs/erp-microservices-architecture.md`](../docs/erp-microservices-architecture.md). OpenAPI surface frontend: [`../docs/openapi/frontend-surface.json`](../docs/openapi/frontend-surface.json).

## Quy ước SRS

- Tên file/folder UTF-8, kebab-case, không dấu (dễ path, dễ diff).
- Mỗi use case có mã `UC-<MODULE>-<NNN>` — ví dụ `UC-POS-001`.
- Mọi tham chiếu source code dùng dạng markdown link `[file.java](path/file.java)`.
- State machine + sequence diagram dùng Mermaid.
