# 📂 Module: Tham chiếu & Tổ chức

**Service:** `org-service` ([services/org-service](../../services/org-service)), `master-node` (control plane)
**Frontend:** [frontend/src/components/org/OrgModule.tsx](../../frontend/src/components/org/OrgModule.tsx)
**Base API:** `/api/v1/org`

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-ORG-001 | Quản lý vùng (region) | [quan-ly-vung.md](./quan-ly-vung.md) |
| UC-ORG-002 | Quản lý outlet | [quan-ly-outlet.md](./quan-ly-outlet.md) |
| UC-ORG-003 | Cấu hình tiền tệ & tỷ giá | [cau-hinh-tien-te-ty-gia.md](./cau-hinh-tien-te-ty-gia.md) |
| UC-ORG-004 | Cấu hình thuế | [cau-hinh-thue.md](./cau-hinh-thue.md) |
| UC-ORG-005 | Cấu hình dịch vụ & rollout | [cau-hinh-dich-vu.md](./cau-hinh-dich-vu.md) |

## Bảng DB

`region`, `outlet`, `currency`, `exchange_rate`, `service_instance`, `service_config_profile`, `service_rollout`.
