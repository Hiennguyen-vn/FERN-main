# 📂 Module: IAM (Identity & Access Management)

**Service:** `auth-service` ([services/auth-service](../../services/auth-service))
**Frontend:** [frontend/src/components/iam/IAMModule.tsx](../../frontend/src/components/iam/IAMModule.tsx)
**Base API:** `/api/v1/auth`

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-IAM-001 | Đăng nhập | [dang-nhap.md](./dang-nhap.md) |
| UC-IAM-002 | Quản lý người dùng | [quan-ly-nguoi-dung.md](./quan-ly-nguoi-dung.md) |
| UC-IAM-003 | Phân quyền vai trò | [phan-quyen-vai-tro.md](./phan-quyen-vai-tro.md) |
| UC-IAM-004 | Gán scope outlet/vùng | [gan-scope-outlet-vung.md](./gan-scope-outlet-vung.md) |
| UC-IAM-005 | Ghi đè quyền người dùng | [ghi-de-quyen.md](./ghi-de-quyen.md) |
| UC-IAM-006 | Quản lý phiên (session) | [quan-ly-phien.md](./quan-ly-phien.md) |

## Bảng DB

`app_user`, `role`, `permission`, `role_permission`, `user_role`, `user_permission`, `auth_session`.

## Ghi chú

- Canonical roles xem [ACTORS.md](../ACTORS.md).
- Admin chỉ governance (`auth.user.write`, `auth.role.write`, `org.write`, `audit.read`) sau seed 011 §8.1.
