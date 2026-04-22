# 📂 Module: Tài chính & Lương

**Services:** `finance-service`, `payroll-service`
**Frontend:** [frontend/src/components/finance/](../../frontend/src/components/finance), [frontend/src/components/hr/PayrollModule.tsx](../../frontend/src/components/hr/PayrollModule.tsx)
**Base API:** `/api/v1/finance`, `/api/v1/payroll`, `/api/v1/procurement/payments` (phần thanh toán NCC)

## Use Cases

| Mã | Tên | File |
|----|-----|------|
| UC-FIN-001 | Thanh toán nhà cung cấp | [thanh-toan-ncc.md](./thanh-toan-ncc.md) |
| UC-FIN-002 | Chạy bảng lương (payroll period) | [chay-bang-luong.md](./chay-bang-luong.md) |
| UC-FIN-003 | Đóng kỳ tài chính | [dong-ky-tai-chinh.md](./dong-ky-tai-chinh.md) |
| UC-FIN-004 | Báo cáo P&L | [bao-cao-pnl.md](./bao-cao-pnl.md) |
| UC-FIN-005 | Quản lý chi phí vận hành | [quan-ly-chi-phi-van-hanh.md](./quan-ly-chi-phi-van-hanh.md) |

## Bảng DB

`expense_operating`, `expense_other`, `expense_payroll`, `expense_inventory_purchase`, `payroll`, `payroll_period`, `payroll_timesheet`, `supplier_payment`, `supplier_payment_allocation`, `fiscal_period` (nếu có).

## Liên module

- Payment NCC (UC-FIN-001) thuộc procurement-service nhưng quyền `finance` approve.
- Payroll ghi `expense_payroll` sang finance.
- Prime cost báo cáo chờ procurement/inventory COGS pipeline.
