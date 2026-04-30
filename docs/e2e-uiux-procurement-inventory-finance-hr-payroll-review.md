# E2E UI/UX + Functional Review - Procurement / Inventory / Finance / HR / Payroll

Review date: 2026-04-29  
Reviewer: Codex via Browser Use on the in-app browser  
Frontend tested: `http://localhost:5175`  
Backend/gateway observed: `http://localhost:8080`; `http://localhost:8082` is `infra-master-node-1` and returns API `unauthorized` at `/`, not the admin frontend shell.

## Scope

Source scenarios reviewed against the live UI:

- `fern_docs-2/thu-mua`
- `fern_docs-2/kho-outlet`
- `fern_docs-2/tai-chinh-luong`
- `fern_docs-2/nhan-su-cham-cong`
- `docs/authorization-business-rules.md`

The first browser pass was intentionally non-destructive: forms were opened and inspected, outlet scope was changed, dropdowns were selected where safe, but no create/approve/post/reverse/close action was submitted. A later deterministic E2E retest did create isolated procurement, inventory, finance, workforce, and audit records using unique refs listed below.

## Evidence Collected

Browser routes inspected:

- `/dashboard`
- `/procurement`
- `/inventory`
- `/finance`
- `/hr`
- `/workforce`
- `/audit`

## E2E Retest - 2026-04-29

Retest target: admin frontend `http://localhost:5175` with outlet scope `SIM-TODAY-OUT-0001` (`3484207602558582786`).  
Execution: Browser Use in the in-app browser. DB was not wiped; new unique transaction refs were used.

Created/verified records:

- PO `PO-677120`, id `3484508243596677120`, supplier `Mekong Fresh Meats VN`, two lines, total `620,000 VND`.
- GR `GR-559040`, id `3484508616281559040`, lot `E2E-LOT-20260429`, partial receipt `250,000 VND`.
- Invoice `INV-20260429-452276`, id `3484508927117234176`, approved for `250,000 VND`.
- Payment `PAY-498477`, id `3484509117794488320`, posted for `250,000 VND`.
- Waste record for `Pork Belly`, qty `1`, reason `OVERCOOK`, note `E2E waste check`.
- Workforce attendance assignment/approval for `Dinh Hong Son SIM-TODAY-EMP-0373`.

Passes confirmed:

- Selecting outlet scope persists through Procurement, Inventory, Finance, HR, Workforce, and Audit navigation.
- PO create -> approve -> partial GR -> approve/post -> stock ledger pipeline works.
- Invoice approve -> payment post -> Finance Operating Expenses shows invoice-linked expense.
- Waste create updates Waste History and Inventory Ledger.
- Workforce assignment and attendance approval flow reaches approved state.
- Payroll paid rows no longer show contradictory `Awaiting finance approval`; HR prep summary no longer shows `203 of 0 employees`.
- Finance Overview now uses outlet scope on direct `?scope=outlet:...` links, shows `April 2026 · 1551 orders` instead of `0 orders`, renders daily revenue, and scopes Recent Expenses to outlet 1 only.
- Audit rows now show derived domain module, non-blank correlation fallback, and `system` for async events without actor metadata.

Remaining gaps:

- Audit producer payloads for some async Procurement/Finance events still do not carry the human actor/correlation from the originating request, so the UI can only show `system` plus an audit-log correlation fallback for those legacy rows.
- Workforce candidate picker is improved but still too broad: POS test users and long repeated staff lists remain visible without role/outlet/contract/conflict badges.
- Period Close checklist is usable, but close/reopen proof and variance-review completion workflow still need a clearer final wizard.

Initial browser validation on 2026-04-29 before the final fixes:

- Procurement at `/procurement` rendered PO create/list/detail surfaces and `Purchase Orders (8356)`. The screen was scoped to `SIM-TODAY-OUT-0001`, but navigation to other modules did not keep that scope.
- Inventory at `/inventory` first fell back to `All` and blocked with `Outlet selection required`. After selecting `SIM-TODAY-OUT-0001`, it showed `Stock Balances (80)` and negative rows such as `Shrimp -30.00` and `Fish Fillet -180.00`; available tabs were `Stock Balances`, `Ledger`, `Stock Counts`, and `Waste`, with no direct adjustment tab.
- Finance at `/finance` showed `Region VN`, `April 2026 - 0 orders`, `Net Sales` populated at VND 1,292,426,960, and `Daily revenue` still displayed `No data for this period`; `Refresh` was disabled while this inconsistent state was visible.
- Finance `Labor & Payroll` showed paid payroll rows whose run-state copy still said `Awaiting finance approval`.
- HR at `/hr` showed `Attendance Review (0)` for the selected day; the Employees tab showed `945 employees`, many duplicate names, many `No active contract` entries, and `Canon Superadmin` in the employee picker surface.
- Workforce at `/workforce` required selecting an outlet; after selecting `SIM-TODAY-OUT-0001`, the staff assignment modal included `Canon Superadmin`, POS test users, and many repeated staff names without role/outlet/contract/conflict badges.
- Audit at `/audit` showed `Audit Logs (543)`, but many recent rows used generic actions like `update event` or `update stock_balance` and had blank actor/correlation cells.

Read-only backend checks:

- Outlet `SIM-TODAY-OUT-0001` has `80` stock-balance rows, including `6` negative stock rows.
- Same outlet has `510,884` inventory transactions and `23,883` `waste_out` transactions.
- Same outlet has `1,733` April 2026 sales rows totaling `121,193,200`.
- `VN payroll 2026-03` has `203` timesheets and `203` payroll runs; all runs are currently `paid`.

## Executive Summary

The admin frontend has useful read/list surfaces for all requested domains, and several operational forms already exist. The final retest cleared the earlier scope, finance overview, payroll-label, and basic audit-display regressions. The remaining risks are workflow completeness gaps and audit producer metadata gaps that make a subset of test proof weaker than the target script.

Remaining highest priority fixes:

1. Enrich audit producer payloads with originating actor, role/outlet, and request correlation.
2. Rework workforce assignment UX to avoid broad duplicate/unfiltered staff lists.
3. Complete missing lifecycle actions and disabled-state reasons for Procurement, Inventory, Finance, HR, and Payroll.
4. Add a clearer Period Close close/reopen wizard and variance-review completion flow.
5. Standardize currency, date, language, IDs, and audit display conventions.

## Findings

### P1 - Scope State Is Not Stable Across Routes

Observation:

- Selecting `SIM-TODAY-OUT-0001` in one module does not reliably persist when navigating to another module.
- Inventory and Workforce block with a clear "select outlet" state when scope is `All`.
- Procurement behaves differently: it still renders create forms and large all-outlet queues, then shows "Outlet scope not selected" at the bottom.

Impact:

- E2E cases that move from PO -> GR -> Inventory -> Finance can silently switch from outlet-scoped to all-region data.
- Operators may fill a form before realizing it is not actionable.

Recommendation:

- Put `scopeOutletId` in the URL query or a shared persisted shell state.
- Show the active scope near every form title.
- Hide outlet-scoped create forms until a single outlet is selected.
- Add disabled-state text such as "Select one outlet to create PO".

Retest status:

- Fixed for navigation and direct links: `?scope=outlet:3484207602558582786` now hydrates the shell scope, and Finance renders outlet 1 data only.

### P1 - Finance Can Show Partial Truth as Final State

Observation:

- Finance overview initially showed `April 2026 - 0 orders`, `$0`/no-sales states while backend sales data existed.
- After waiting longer, KPI values populated, but `Daily revenue` still said "No data for this period" while net sales and outlet performance were populated.
- Old console errors showed `sales-service` circuit breaker timeouts.

Impact:

- Period close and P&L checks can be trusted incorrectly during transient service failure or slow data loading.
- Cross-module tests like Sale -> Finance P&L are hard to assert.

Recommendation:

- Use server-side summary endpoints for finance dashboards instead of loading large sales pages client-side.
- Show explicit loading, stale, partial, and error states.
- Do not render `0 orders` or `No data` until all required revenue sources have resolved.
- Keep Refresh enabled when data is stale or partially failed.

Retest status:

- Fixed in Overview: order count now comes from monthly revenue, daily chart from daily revenue, and Recent Expenses is client-scoped to the selected outlet.

### P1 - Payroll Statuses Are Internally Contradictory

Observation:

- Finance Labor & Payroll rows show status `paid` while also saying "Awaiting finance approval".
- Period close card showed `0 approved / 0 pending` while payroll rows are `paid` and period-close blockers list outlets awaiting payroll approval.
- Payroll Prep displayed "203 of 0 employees have timesheets" in the review step.

Impact:

- Test cases `TC-PRL-08..11` cannot be verified reliably.
- Finance approval vs mark-paid workflow is ambiguous.

Recommendation:

- Normalize state labels around one state machine: `DRAFT -> APPROVED -> PAID`.
- Never show "Awaiting finance approval" for `paid`.
- Period close should treat paid as beyond approved, or clearly separate `approved_not_paid` vs `paid`.
- Fix the timesheet summary denominator and add empty/partial roster handling.

Retest status:

- Fixed for the observed labels: paid rows show `Paid`, and Payroll Prep shows `15 timesheets imported (roster not loaded)` instead of `203 of 0 employees`.

### P1 - Workforce Assignment Modal Is Too Broad and Unsafe

Observation:

- `+ Add staff to this shift` opens a very large flat button list with repeated names.
- It includes `Canon Superadmin`, POS test users, and many duplicated display names.
- The list lacks role, contract status, outlet, scheduled conflict, and active-contract indicators.

Impact:

- `TC-SHF-05..10` cannot be tested confidently from UI.
- Operators can easily assign the wrong person or a person without the right active contract/role.

Recommendation:

- Filter candidates by active contract, outlet, required role, and availability.
- Deduplicate by `user_id`, not display name.
- Add role/outlet/contract badges and conflict warnings before assignment.
- Virtualize or page the staff picker.

### P1 - Procurement Lifecycle Coverage Is Partial

Observed as present:

- Supplier list and supplier create form.
- Purchase Order create form, PO list, detail modal, `Approve` action.
- Goods Receipt create form and GR list.
- Invoice queue and approval surface.
- Payment create form and payment post/cancel/reverse buttons.

Gaps against the E2E script:

- PO cancel is not visible in the list or detail modal.
- PO edit/immutable lock is not testable from UI.
- Region threshold approval is not surfaced.
- GR over-receipt tolerance, damage quantity, and unit-cost override are not obvious in the create flow.
- Invoice 3-way match variance/finance override is not visible as an explicit review state.
- Payment form supports a single invoice allocation, while the finance tests include multi-invoice allocation and advance payment.
- Payment form defaults to `Payment amount 0.00 USD` before invoice selection, even on a VND outlet.

Recommendation:

- Add a status-action matrix per row/detail panel with disabled reasons.
- Add explicit PO `Cancel`, immutable edit guards, and approval threshold banners.
- Add GR line fields for received/damaged/over-receipt warning.
- Add invoice match panel: PO qty, GR qty, invoice qty, unit-price variance, tax variance, override action.
- Decide whether supplier payment belongs under Procurement, Finance/AP, or both; align navigation with `UC-FIN-001`.

### P2 - Inventory UX Needs Stronger Operational States

Observed as present:

- Stock balances with low-only filter.
- Inventory ledger.
- Stock count create/list/post review entry point.
- Waste create form and waste history.

Gaps:

- Direct inventory adjustment (`UC-INV-003`) is not visible as its own tab/action.
- Negative stock is displayed as a normal number; no oversell/shortage explanation is visible.
- Low-stock highlighting is not prominent enough in the table.
- Stock count create form does not expose FULL vs PARTIAL scope clearly.
- Count line ownership (`counted_by`, counted time) is not visible.

Recommendation:

- Add an `Adjustments` tab for FOUND/DAMAGED/manual deltas with explicit reason enum.
- Add negative-stock badges with links to oversell/audit/ledger context.
- Add stock-count mode selector: FULL / PARTIAL, expected snapshot preview, counter assignment, approval-needed state.

### P2 - HR Contracts and Attendance Are Hard to Operate From the Current UI

Observed:

- Attendance review defaults to today and showed no records.
- Employee list renders a very large button list with many "No active contract" rows.
- Contracts table exists, but create/amend/terminate actions are not obvious in the first screen.

Impact:

- `TC-CTR-*` and `TC-ATT-*` cannot be driven step-by-step from a clear operator path.
- HR users need better filtering and task-oriented empty states.

Recommendation:

- Add contract action bar: New Contract, Amend, Terminate, filter active/terminated/overlap risk.
- Add attendance import/manual-entry action and clear pending-review queues.
- Make employee list table-like with pagination, role, outlet, contract state, and search filters.

### P2 - Period Close Is Not a Complete Close/Reopen Console

Observation:

- Period Close tab shows a payroll-period list and outlet blockers.
- A final `Close period` / `Reopen period` action was not obvious in the inspected view.
- Current blockers emphasize payroll, but the E2E cases also require invoice/payment/expense preflight failures and P&L snapshot generation.

Recommendation:

- Create a dedicated close wizard: preflight checks, blocker details, final close action, reopen action gated by superadmin reason.
- Show invoice/payment/expense/payroll/audit/P&L snapshot readiness independently.

### P2 - Audit Trail Is Too Generic for E2E Proof

Observation:

- Audit list has many `update event`, `update stock_balance`, and `insert outlet` rows.
- Actor and correlation are often blank or shown as `-`.

Impact:

- Manager override, payroll approval/rejection, period reopen, and stock-count approval tests cannot be proven cleanly from UI.

Recommendation:

- Add domain-specific action labels and filters: manager override, payroll approve, payroll mark-paid, waste, stock count post, period close/reopen.
- Show actor name, role, outlet, correlation/request ID, and before/after summary.

Retest status:

- Partially fixed in UI: rows now show derived module labels and a non-blank correlation fallback. Events without actor metadata render as `system`; producers still need to pass the originating actor for full proof.

### P3 - Presentation Consistency Issues

Observed inconsistencies:

- Dashboard used `$` for VND amounts; Finance later used the VND currency symbol; Procurement uses `VND` suffix.
- Dates appear as `2026-04-28`, `4/29/2026`, `Apr 6, 2026`, and `01/03/2026`.
- UI mixes English and Vietnamese labels, for example the Vietnamese "shift work" label inside an English Workforce screen.
- Long 64-bit IDs are shown directly in tables and modals.

Recommendation:

- Define one locale/currency formatting policy per tenant/region.
- Use short display refs in tables; move full IDs behind copy buttons/tooltips.
- Keep one language per screen or add a tenant-level language setting.

## E2E Coverage Matrix

| Domain | Current UI readiness | Notes |
| --- | --- | --- |
| Procurement PO | Partial | Create/list/detail/approve visible. Missing cancel/edit-lock/threshold approval UX. |
| Goods Receipt | Partial | Create/list actions visible. Tolerance/damage/override states not obvious. |
| Supplier Invoice | Partial | Invoice queue exists. Explicit 3-way match and variance override missing. |
| Supplier Payment | Partial | Single-invoice payment visible under Procurement. Multi-allocation/advance/reverse-proof needs UX work. |
| Inventory Stock | Partial | Balance and ledger work after load. Negative/low-stock context needs stronger UI. |
| Stock Count | Partial | Create/list/post entry exists. FULL/PARTIAL, counter ownership, approval state need work. |
| Adjustment | Missing/unclear | No dedicated adjustment tab found. |
| Waste | Partial | Create/history exists. Reason should be enum-controlled and tied to prime-cost proof. |
| Finance Expense | Partial | Operating/other expense form exists. Category, receipt upload, closed-period guard not visible. |
| Period Close | Partial | Checklist exists. Close/reopen/preflight/P&L snapshot actions not obvious. |
| HR Contracts | Partial | Contract table exists. Create/amend/terminate path not obvious. |
| Scheduling | Partial | Workforce board and assignment exist, but candidate picker is unsafe. |
| Attendance | Partial | Review table exists. Manual entry/approve workflow not obvious from empty state. |
| Payroll | Partial | HR prep and Finance approval surfaces exist. Status labels and counters are inconsistent. |
| Audit | Partial | Audit list exists. Domain proof fields are too sparse. |

## Recommended Fix Order

1. Scope persistence and outlet-required form gating.
2. Finance loading/error truth states and server-side summary usage.
3. Payroll state-label/counter corrections.
4. Workforce assignment filtering/deduplication.
5. Procurement lifecycle action matrix and variance panels.
6. Inventory adjustment and stock-count state expansion.
7. HR contract/attendance action surfaces.
8. Audit event enrichment and filters.
9. Currency/date/language/ID formatting cleanup.

## Suggested Retest Plan

After fixes, run a smaller deterministic E2E pass before the full list:

1. Login as superadmin, select `SIM-TODAY-OUT-0001`, navigate across Procurement -> Inventory -> Finance -> HR -> Workforce, and verify scope persists.
2. Create one PO with two lines, approve, receive partially, post GR, then verify stock ledger and PO received state.
3. Create one matched invoice, approve, create payment, post, verify expense and P&L.
4. Create one waste record, verify inventory ledger and finance prime-cost reporting.
5. Create/assign one shift with a valid active-contract staff member, approve attendance, import payroll, generate run, approve, mark paid, verify period close readiness.
6. Verify audit rows for every mutation include actor, role, outlet, entity, and correlation ID.
