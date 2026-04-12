# Use Case Diagram Catalog

This directory stores the standardized, reusable PlantUML use case diagrams for FERN.

All diagrams here are:

- derived from source code
- one file per diagram
- self-contained with no shared `!include`
- named with stable numeric prefixes for deterministic sorting
- labeled in Vietnamese with English on the next line for traceability

## Conventions

- Actor aliases are reused across files:
  - `ACT_CUSTOMER`
  - `ACT_STAFF`
  - `ACT_CASHIER`
  - `ACT_MANAGER`
  - `ACT_HR`
  - `ACT_PROCUREMENT`
  - `ACT_FINANCE`
  - `ACT_AUDITOR`
  - `ACT_ADMIN`
- Use case IDs are stable by domain:
  - `UC-AUTH-*`
  - `UC-ORG-*`
  - `UC-CAT-*`
  - `UC-SALES-*`
  - `UC-PUB-*`
  - `UC-CRM-*`
  - `UC-INV-*`
  - `UC-PROC-*`
  - `UC-HR-*`
  - `UC-PAY-*`
  - `UC-FIN-*`
  - `UC-AUD-*`
  - `UC-RPT-*`
- `01-usecase-overview.puml` is a capability-level overview.
- Domain files `02` to `14` contain leaf use cases tied to controller routes or source-confirmed operational flows.
- Platform internals and placeholders are intentionally excluded:
  - gateway internals
  - master/control-plane operations
  - simulator
  - settings placeholder
  - scheduling placeholder
  - workforce placeholder

## File Map

| File | Domain | Actors | Use case ID range | Nguồn xác nhận |
|---|---|---|---|---|
| `01-usecase-overview.puml` | Tổng quan hệ thống | Customer, Staff, Cashier, Manager, HR, Procurement, Finance, Auditor, Admin | capability groups only | Controller inventory + `docs/frontend-readiness.md` |
| `02-usecase-auth-iam.puml` | Auth & IAM | Staff, Admin | `UC-AUTH-01`..`UC-AUTH-13` | `services/auth-service/.../AuthController.java`, `docs/frontend-readiness.md` |
| `03-usecase-organization.puml` | Organization | Staff, Admin | `UC-ORG-01`..`UC-ORG-08` | `services/org-service/.../OrgController.java`, `docs/frontend-readiness.md` |
| `04-usecase-catalog-pricing.puml` | Catalog & Pricing | Staff, Manager, Admin | `UC-CAT-01`..`UC-CAT-09` | `services/product-service/.../ProductController.java`, `docs/frontend-readiness.md` |
| `05-usecase-sales-pos-staff.puml` | Sales / POS staff | Cashier, Manager, Admin | `UC-SALES-01`..`UC-SALES-22` | `services/sales-service/.../SalesController.java`, `docs/frontend-readiness.md`, `docs/frontend-api-gap-analysis.md` |
| `06-usecase-sales-public-ordering.puml` | Public ordering | Customer | `UC-PUB-01`..`UC-PUB-04` | `services/sales-service/.../PublicPosController.java`, `docs/frontend-readiness.md` |
| `07-usecase-crm.puml` | CRM | Cashier, Manager, Admin | `UC-CRM-01` | `services/sales-service/.../CrmController.java`, frontend POS flow |
| `08-usecase-inventory.puml` | Inventory | Staff, Manager, Admin | `UC-INV-01`..`UC-INV-08` | `services/inventory-service/.../InventoryController.java`, `docs/frontend-readiness.md` |
| `09-usecase-procurement.puml` | Procurement | Procurement, Finance, Manager, Admin | `UC-PROC-01`..`UC-PROC-23` | Procurement controllers, `docs/frontend-readiness.md` |
| `10-usecase-hr.puml` | HR | Staff, HR, Manager, Admin | `UC-HR-01`..`UC-HR-21` | `services/hr-service/.../HrController.java`, `docs/frontend-readiness.md` |
| `11-usecase-payroll.puml` | Payroll | Finance, Admin | `UC-PAY-01`..`UC-PAY-12` | `services/payroll-service/.../PayrollController.java`, `docs/frontend-readiness.md` |
| `12-usecase-finance.puml` | Finance | Finance, Admin | `UC-FIN-01`..`UC-FIN-04` | `services/finance-service/.../FinanceController.java`, `docs/frontend-readiness.md` |
| `13-usecase-audit.puml` | Audit | Auditor, Admin | `UC-AUD-01`..`UC-AUD-04` | Audit controllers, `docs/frontend-readiness.md` |
| `14-usecase-reporting.puml` | Reporting | Manager, Finance, Admin | `UC-RPT-01`..`UC-RPT-05` | `services/report-service/.../ReportController.java`, `frontend/src/hooks/use-dashboard-data.ts`, `docs/frontend-readiness.md` |

## Usage Notes

- If another document wants a single system-level picture, use `01-usecase-overview.puml`.
- If another document needs precise scope by business domain, embed the domain file directly.
- If a file is copied outside this repository, it should still render because each file contains its own style and actor declarations.
- The current environment does not ship with local `plantuml` or `graphviz`, so this directory stores source `.puml` files only.
