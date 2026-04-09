# Rebuild checklist

Status snapshot updated: 2026-04-06

## Foundation
- [x] Workspace scaffold
- [x] Stitch-based tokens and typography
- [x] Shared primitives
- [x] Backoffice shell
- [x] Auth/session bootstrap
- [x] Route policies and outlet scope
- [ ] Cashier shell (dedicated shell split not yet isolated from backoffice shell)
- [ ] Public ordering shell (dedicated public route shell still pending)

## Modules
- [x] Dashboard
- [x] Access (IAM-backed)
- [x] Hierarchy / org settings
- [x] Catalog
- [x] Pricing (inside catalog workspace)
- [x] Inventory
- [x] Reports (read-only)
- [x] HR
- [x] Procurement
- [x] Sales/POS operational surfaces
- [x] Payroll (periods/runs via HR/Finance tabs)
- [x] Finance (read + create)
- [x] Audit (read-only)
- [ ] Protected orders dedicated module (staff queue currently covered through sales/POS surfaces)
- [ ] Public ordering route module (customer route is still pending as a standalone page)

## Intentional boundaries
- [x] CRM, Scheduling, Workforce are explicit unsupported/live-boundary screens
- [x] Reports remain read-only
- [x] Audit remains read-only
- [x] Inventory stock balances remain non-editable directly
- [x] Public customer flow remains payment-free (no public payment endpoint)

## Validation
- [x] `npm run build`
- [x] `npm run test`
- [ ] `npm run test:e2e`
- [ ] `PLAYWRIGHT_LIVE=1 npm run test:e2e:live`
