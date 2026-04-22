# 📂 Module: Nhân sự & Chấm công

**Service:** `hr-service` ([services/hr-service](../../services/hr-service))
**Frontend:** [frontend/src/components/hr/](../../frontend/src/components/hr), [frontend/src/components/workforce/](../../frontend/src/components/workforce)
**Base API:** `/api/v1/hr`

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-HR-001 | Hồ sơ nhân viên | [ho-so-nhan-vien.md](./ho-so-nhan-vien.md) |
| UC-HR-002 | Phân ca làm việc | [phan-ca-lam-viec.md](./phan-ca-lam-viec.md) |
| UC-HR-003 | Phê duyệt chấm công | [phe-duyet-cham-cong.md](./phe-duyet-cham-cong.md) |
| UC-HR-004 | Tạo hợp đồng lao động | [tao-hop-dong-lao-dong.md](./tao-hop-dong-lao-dong.md) |
| UC-HR-005 | Xem lịch ca live (workforce) | [xem-ca-lam-viec.md](./xem-ca-lam-viec.md) |

## Bảng DB

`shift`, `work_shift`, `employment_contract`, `shift_role_requirement`, `hr_employee`.

## Liên module

- Chấm công approved → payroll (UC-FIN-002).
- Contract active → điều kiện phân ca (UC-HR-002).
