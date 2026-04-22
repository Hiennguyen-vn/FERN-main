# 📂 Module: Audit & Traceability

**Service:** `audit-service` ([services/audit-service](../../services/audit-service))
**Frontend:** [frontend/src/components/audit/AuditModule.tsx](../../frontend/src/components/audit/AuditModule.tsx)
**Base API:** `/api/v1/audit`

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-AUD-001 | Xem nhật ký audit | [xem-nhat-ky-audit.md](./xem-nhat-ky-audit.md) |
| UC-AUD-002 | Xem sự kiện bảo mật | [su-kien-bao-mat.md](./su-kien-bao-mat.md) |
| UC-AUD-003 | Truy vết request | [truy-vet-request.md](./truy-vet-request.md) |
| UC-AUD-004 | Ghi audit log hệ thống | [ghi-audit-log-he-thong.md](./ghi-audit-log-he-thong.md) |

## Bảng DB

`audit_log`, `catalog_audit_log`.

## Event convention

Event name: `<module>.<entity>.<action>` — ví dụ `sale.paid`, `hr.contract.created`.
