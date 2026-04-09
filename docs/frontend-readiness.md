# Frontend Readiness

Last updated: 2026-03-31

This document tracks source-confirmed frontend readiness for FERN. Backend code is the source of truth when docs drift.

## Scope

- Frontend workspace: `/Users/nguyendinhkhiem/Development/Javas/FERN/frontend`
- Public backend entrypoint: gateway only
- Auth model: JWT bearer through the gateway
- Primary business boundary: outlet-scoped access with region metadata layered on top
- Current frontend phase: read-first operational foundation with selective write-safe actions where the backend contract is already explicit and tested

## Confirmed Truths From Source

### Runtime and security

- Gateway is the only intended public HTTP entrypoint.
- Gateway strips client-supplied `X-Internal-*` headers and forwards verified user context downstream after JWT validation.
- Gateway-forwarded user requests remain user-scoped downstream and do not become privileged internal-service calls.
- Gateway intentionally leaves `/api/v1/sales/public/**` public for the customer QR/table-ordering flow, which stays table-token scoped and separate from the staff shell.
- Control-plane routes are operational/internal and should not be part of the normal product frontend.
- `401` means missing or invalid auth.
- `403` means authenticated but outside the server-enforced role, permission, or outlet boundary.

Primary sources:
- [GatewayAuthenticationFilter.java](/Users/nguyendinhkhiem/Development/Javas/FERN/gateway/src/main/java/com/fern/gateway/security/GatewayAuthenticationFilter.java)
- [RequestAuthenticationFilter.java](/Users/nguyendinhkhiem/Development/Javas/FERN/common/service-common/src/main/java/com/dorabets/common/spring/auth/RequestAuthenticationFilter.java)
- [ServiceExceptionHandler.java](/Users/nguyendinhkhiem/Development/Javas/FERN/common/service-common/src/main/java/com/dorabets/common/spring/web/ServiceExceptionHandler.java)

### Session and identity

- Login: `POST /api/v1/auth/login`
- Session bootstrap: `GET /api/v1/auth/me`
- Refresh: `POST /api/v1/auth/refresh`
- Logout: `POST /api/v1/auth/logout`
- Session inventory: `GET /api/v1/auth/sessions`
- Session revoke: `POST /api/v1/auth/sessions/{sessionId}/revoke`
- Current session data includes:
  - `rolesByOutlet`
  - `permissionsByOutlet`
  - `outletIds` derived by the frontend from those outlet-keyed maps

Primary sources:
- [AuthController.java](/Users/nguyendinhkhiem/Development/Javas/FERN/services/auth-service/spring/src/main/java/com/fern/services/auth/spring/api/AuthController.java)
- [AuthDtos.java](/Users/nguyendinhkhiem/Development/Javas/FERN/services/auth-service/spring/src/main/java/com/fern/services/auth/spring/api/AuthDtos.java)

### Region, outlet, and seed model

- Regions expose hierarchy, currency, tax, and timezone metadata.
- Outlets are tied to regions and form the main operational scope unit.
- Seeded workflow users from [010_workflow_validation_seed.sql](/Users/nguyendinhkhiem/Development/Javas/FERN/db/seeds/010_workflow_validation_seed.sql):
  - `workflow.admin`
  - `workflow.hcm.manager`
  - `workflow.us.manager`
  - `workflow.hcm.cashier`
- Shared password for `workflow.*` users: `Workflow#2026!`
- Seeded regions and outlets support both Vietnam and US outlet-scoped validation.

### Roles and permission caveats

- Frontend authorization must follow actual backend checks, not only seed names.
- Important code-vs-seed mismatches:
  - HR services enforce `hr.schedule`, not `hr.write`
  - Inventory writes enforce `inventory.write`, not `inventory.adjust`
  - Finance and payroll reads are role-based admin checks, not outlet-scoped permission strings
  - Sales writes enforce `sales.order.write`

Primary sources:
- [ShiftService.java](/Users/nguyendinhkhiem/Development/Javas/FERN/services/hr-service/src/main/java/com/fern/services/hr/application/ShiftService.java)
- [WorkShiftService.java](/Users/nguyendinhkhiem/Development/Javas/FERN/services/hr-service/src/main/java/com/fern/services/hr/application/WorkShiftService.java)
- [InventoryService.java](/Users/nguyendinhkhiem/Development/Javas/FERN/services/inventory-service/src/main/java/com/fern/services/inventory/application/InventoryService.java)
- [FinanceService.java](/Users/nguyendinhkhiem/Development/Javas/FERN/services/finance-service/src/main/java/com/fern/services/finance/application/FinanceService.java)
- [PayrollService.java](/Users/nguyendinhkhiem/Development/Javas/FERN/services/payroll-service/src/main/java/com/fern/services/payroll/application/PayrollService.java)
- [SalesService.java](/Users/nguyendinhkhiem/Development/Javas/FERN/services/sales-service/src/main/java/com/fern/services/sales/application/SalesService.java)

## Seeded Access Summary

| User | Confirmed outlet scope | Effective meaning | Confidence |
|---|---|---|---|
| `workflow.admin` | all seeded workflow outlets | global admin-style user seeded with every defined outlet role across the workflow outlets | High |
| `workflow.hcm.manager` | Vietnam workflow outlets | scoped outlet manager | High |
| `workflow.us.manager` | US workflow outlets | scoped outlet manager | High |
| `workflow.hcm.cashier` | single HCM outlet | cashier/sales-only style account | High |

## Backend-Derived Permission Matrix

The frontend now uses a shared access matrix derived from backend source, but that matrix is only as fine-grained as the server contracts actually are today.

| Domain / page | Read contract enforced by backend | Explicit write / action contract enforced by backend | Current frontend gating outcome |
|---|---|---|---|
| Auth / access | authenticated user only | session revoke limited to the caller's own sessions | visible to any authenticated user |
| Org / hierarchy | authenticated; non-admin reads are server-filtered to allowed outlets and visible ancestor regions | admin-only for org mutations not exposed in the frontend | visible to any authenticated user |
| Catalog | authenticated catalog reads | `product.catalog.write` for mutations | page is visible to authenticated users; management stays action gated |
| Dashboard / pricing / reports | outlet-scoped read | no extra named write capability in the current frontend | page is visible to users with outlet scope |
| Inventory | outlet-scoped read | `inventory.write` for mutations | page is visible to users with outlet scope; management stays action gated by named permission |
| HR | outlet-scoped shift and work-shift reads; personal work-shift reads stay user-bound for non-managers | `hr.schedule` or `outlet_manager` for scheduling mutations | page is visible to users with outlet scope; management stays action gated by role/permission |
| Procurement | outlet-scoped supplier and queue reads | `purchase.approve` or `outlet_manager` for the currently exposed queue actions | page is visible to users with outlet scope; actions stay gated by role/permission |
| Sales | outlet-scoped order, POS-session, promotion, public-order queue, and cashier ordering-table link reads with promotion outlet-overlap checks | `sales.order.write` for order approval, payment completion, promotion create/deactivate, POS session actions, cashier checkout, and cashier ordering-table link reads | sales page is visible to users with outlet scope; exact `/order` queue is visible only to users with sales-write capability or admins; cashier-only sessions are intentionally narrowed into exact `/pos`; actions stay gated by named permission |
| Payroll | admin-only | admin-only | hidden from scoped users and route-guarded admin-only |
| Finance | admin-only | admin-only | hidden from scoped users and route-guarded admin-only |
| Audit | admin-only | admin-only | hidden from scoped users and route-guarded admin-only |
| Public POS | public table-token scope only | public order submit and public order-status by opaque order token | separate `/order/{tableToken}` shell with no staff/admin UI |

## Service-by-Service Frontend Readiness

| Service | Purpose | Intended frontend visibility | Current frontend-usable endpoints | Auth and scope model | Classification | Current frontend status | Playwright status | Confidence |
|---|---|---|---|---|---|---|---|---|
| Gateway | ingress, diagnostics, routing boundary | public diagnostics only | `GET /api/v1/gateway/info` | public | fully frontend-usable now | Implemented on dashboard as gateway status card | Mocked and live | High |
| Auth | login and session lifecycle | full frontend surface | `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/sessions`, `POST /api/v1/auth/sessions/{sessionId}/revoke` | public login, JWT for session routes | fully frontend-usable now | Implemented with refresh/logout/session inventory and revocation | Mocked and live | High |
| Master / control-plane | service registry, config, rollouts | excluded from normal frontend | operational/admin routes only | internal or admin | intentionally hidden from the frontend | Intentionally excluded; documented only | Docs only | High |
| Org | regions, outlets, hierarchy, exchange rates | full read surface | `GET /api/v1/org/hierarchy`, `GET /api/v1/org/outlets` | JWT; source confirms non-admin hierarchy and outlet reads are filtered server-side to allowed outlets and visible ancestor regions, and the frontend keeps a client-side filter as defense in depth | fully frontend-usable now | Implemented with backend filtering as the primary contract plus a defensive frontend outlet filter | Mocked and live | High |
| HR | shifts, work shifts, contracts | partial read surface | `GET /api/v1/hr/shifts`, `GET /api/v1/hr/work-shifts`, `GET /api/v1/hr/work-shifts/outlet/{outletId}/date/{date}` | outlet-scoped for non-admin reads; contracts remain admin/internal | partially frontend-usable now | Implemented read-only schedule and personal work-shift screen; contracts deferred | Mocked and live | High |
| Product | catalog, items, pricing, recipes | full read surface for first pass | `GET /api/v1/product/products`, `GET /api/v1/product/items`, `GET /api/v1/product/prices` | JWT; pricing is outlet-scoped | fully frontend-usable now | Implemented | Mocked and live | High |
| Procurement | suppliers, PO/GR/invoice/payment workflows | partial operational surface | `GET /api/v1/procurement/suppliers`, `GET /api/v1/procurement/suppliers/{supplierId}`, `GET /api/v1/procurement/purchase-orders`, `GET /api/v1/procurement/goods-receipts`, `GET /api/v1/procurement/invoices`, `GET /api/v1/procurement/payments`, `POST /api/v1/procurement/purchase-orders/{purchaseOrderId}/approve`, `POST /api/v1/procurement/goods-receipts/{receiptId}/approve`, `POST /api/v1/procurement/goods-receipts/{receiptId}/post`, `POST /api/v1/procurement/invoices/{invoiceId}/approve`, `POST /api/v1/procurement/payments`, `POST /api/v1/procurement/payments/{paymentId}/post`, `POST /api/v1/procurement/payments/{paymentId}/cancel`, `POST /api/v1/procurement/payments/{paymentId}/reverse` | JWT; admins may read all outlets, scoped non-admin users may read only their allowed outlets | partially frontend-usable now | Implemented suppliers, procurement queues, detail panels, supplier-payment creation, queue actions, and paged `limit + offset` envelopes with `totalCount` / `hasNextPage`; deeper lifecycle coverage still deferred | Mocked and live | High |
| Sales | POS sessions, orders, promotions, dedicated cashier POS, staff customer-order queue, and public customer ordering | partial operational surface plus public POS | `GET /api/v1/sales/orders`, `GET /api/v1/sales/orders/{saleId}`, `POST /api/v1/sales/orders`, `POST /api/v1/sales/orders/{saleId}/approve`, `POST /api/v1/sales/orders/{saleId}/confirm`, `POST /api/v1/sales/orders/{saleId}/mark-payment-done`, `GET /api/v1/sales/pos-sessions`, `GET /api/v1/sales/pos-sessions/{sessionId}`, `POST /api/v1/sales/pos-sessions`, `POST /api/v1/sales/pos-sessions/{sessionId}/close`, `GET /api/v1/sales/ordering-tables`, `GET /api/v1/sales/promotions`, `GET /api/v1/sales/promotions/{promotionId}`, `POST /api/v1/sales/promotions`, `POST /api/v1/sales/promotions/{promotionId}/deactivate`, `GET /api/v1/sales/public/tables/{tableToken}`, `GET /api/v1/sales/public/tables/{tableToken}/menu`, `POST /api/v1/sales/public/tables/{tableToken}/orders`, `GET /api/v1/sales/public/tables/{tableToken}/orders/{orderToken}` | JWT for staff reads/writes; public table-token contract for customer ordering; admins may read all outlets, scoped non-admin users may read only their allowed outlets, promotion reads require overlap with the promotion's outlet scope, sales order approval/payment actions require `sales.order.write` on the sale outlet, cashier ordering-table link reads require `sales.order.write` on the requested outlet, promotion deactivation requires sales write coverage across every promotion outlet, and public order-status is scoped by the table token plus opaque order token | partially frontend-usable now | Implemented dedicated cashier `/pos` workspace, stock-safe cashier/public order lifecycle, order/POS session/promotion/customer-order surfaces, POS session open/close, cashier checkout, client-order URL generation/copy, promotion creation/deactivation, paged `limit + offset` envelopes with `totalCount` / `hasNextPage`, and a dedicated `/order/{tableToken}` public ordering shell with persisted public order-status | Mocked and live | High |
| Inventory | balances, movements, stock operations | full read surface for first pass | `GET /api/v1/inventory/stock-balances`, `GET /api/v1/inventory/transactions` | JWT outlet-scoped | fully frontend-usable now | Implemented | Mocked and live | High |
| Payroll | periods, timesheets, payroll approval | admin-only operational surface | `GET /api/v1/payroll/periods`, `GET /api/v1/payroll/periods/{periodId}`, `GET /api/v1/payroll/timesheets`, `GET /api/v1/payroll/timesheets/{timesheetId}`, `GET /api/v1/payroll`, `GET /api/v1/payroll/{payrollId}`, `POST /api/v1/payroll/periods`, `POST /api/v1/payroll/timesheets`, `POST /api/v1/payroll`, `POST /api/v1/payroll/{payrollId}/approve` | JWT admin only | partially frontend-usable now | Implemented periods, timesheets, payroll-run views, period/timesheet creation, payroll generation, and payroll approval | Mocked and live | High |
| Finance | expense ledger and expense writes | admin-only read surface | `GET /api/v1/finance/expenses` | JWT admin only | partially frontend-usable now | Implemented admin-only expense reader with scoped filters and honest empty states | Mocked and live | High |
| Audit | audit log feed | admin-only read surface | `GET /api/v1/audit/logs` | JWT admin only | partially frontend-usable now | Implemented admin-only audit reader with filterable recent-activity feed | Mocked and live | High |
| Report | replica-backed outlet reports | full read surface for first pass | `GET /api/v1/reports/sales`, `expenses`, `inventory-movements`, `low-stock` | JWT outlet-scoped | fully frontend-usable now | Implemented | Mocked and live | High |

Frontend contract note:
- sales order IDs, sales POS session IDs, sales promotion IDs, supplier payment IDs, and payroll period/timesheet/payroll IDs are serialized as strings in frontend-facing payloads so 64-bit identifiers remain lossless in the browser
- staff list-heavy surfaces now use server-backed paged envelopes with `items`, `limit`, `offset`, `totalCount`, and `hasNextPage`, plus cached next-page prefetch on the upgraded sales, procurement, payroll, finance, and audit readers
- `POST /api/v1/auth/refresh` rotates the session by revoking the current session ID and returning a new one, which the frontend now handles explicitly on the access/session screen
- calendar-date and datetime-local inputs now use local calendar values instead of UTC `toISOString()` slices so report, dashboard, inventory, finance, HR, pricing, sales, and procurement windows stay aligned with the selected business day after local midnight
- the current app shell and route guards now hide unreadable staff modules through a shared backend-derived read-policy map and no longer render `READ` / `Manage` / `Admin` sidebar badges
- cashier-only sessions now default into the dedicated `/pos` workspace, do not land in the generic operations console, and are redirected there from generic backoffice routes other than `/access`
- the product still stops short of claiming fully permission-granular navigation because many backend read contracts remain coarse outlet-scoped surfaces
- public customer ordering now persists and refreshes order-status through an opaque `orderToken` instead of exposing internal sale IDs in the browser URL
- public QR/table orders and cashier-created orders now move through `order_created -> order_approved -> payment_done`
- stock is checked on create and rechecked on approval; approval is the inventory-consuming boundary
- payment completion is the event boundary for finalized sales and captured-payment events
- public QR/table orders now use that same lifecycle from the protected staff queue, which lives at exact `/order` for non-cashier staff and under `/pos?tab=customer-orders` for cashier-only users

## Route Classification

| Route area | Classification | Notes | Confidence |
|---|---|---|---|
| `/api/v1/auth/login` | Public | normal login surface | High |
| `/api/v1/auth/me` | Authenticated | session bootstrap route | High |
| `/api/v1/auth/refresh` | Authenticated | refreshes the active session token before expiry | High |
| `/api/v1/auth/logout` | Authenticated | revokes the active session | High |
| `/api/v1/auth/sessions` | Authenticated | exposes session inventory and revocation for the current user | High |
| `/api/v1/gateway/info` | Public | operational diagnostics only | High |
| `/api/v1/control/**` | Internal/admin | excluded from normal frontend | High |
| `/api/v1/master/**` | Internal compatibility | excluded from normal frontend | High |
| `/api/v1/org/**` | Authenticated and backend-filtered | source confirms non-admin hierarchy and outlet reads are filtered server-side, and the frontend still filters to allowed outlets before rendering | High |
| `/api/v1/hr/**` | Mixed | shifts and work-shifts are outlet-scoped; contracts are admin/internal | High |
| `/api/v1/product/**` | Authenticated | pricing remains outlet-scoped | High |
| `/api/v1/procurement/**` | Mixed | supplier, PO, goods-receipt, invoice, and payment reads are usable, and selected queue actions are now exposed | High |
| `/api/v1/sales/**` | Outlet-scoped read plus write | orders, POS sessions, and promotions now have list/detail read surfaces, promotion creation, and scoped promotion deactivation | High |
| `/api/v1/sales/public/**` | Public, table-token scoped | dedicated QR/table customer ordering only; separate from the staff shell | High |
| `/api/v1/inventory/**` | Outlet-scoped | operational reads are ready | High |
| `/api/v1/payroll/**` | Admin-only | periods, timesheets, and payroll runs now have list/detail read models | High |
| `/api/v1/finance/**` | Admin-only | current frontend uses read-only expense list | High |
| `/api/v1/audit/**` | Admin-only | current frontend uses recent log feed | High |
| `/api/v1/reports/**` | Outlet-scoped | report-service stays read-only | High |

## Features Possible Now

### Implemented in the frontend

- login and session bootstrap
- token refresh, logout, session list, and session revoke
- route guards from real outlet/role scope
- backend-derived readable-surface app shell and navigation
- outlet and region context display
- access summary page
- hierarchy and outlet context view
- catalog and pricing read views
- inventory balances and movements
- report reads
- HR shift/schedule read view
- HR personal work-shift read view
- procurement supplier read view
- procurement supplier detail view
- procurement purchase-order queue
- procurement goods-receipt queue
- procurement invoice queue
- procurement payment queue
- procurement purchase-order approval
- procurement goods-receipt approval and posting
- procurement invoice approval
- procurement supplier-payment creation, posting, cancel, and reverse
- dedicated cashier POS workspace at exact `/pos`
- cashier POS session open and close actions
- cashier quick-sale checkout using the existing sales submit contract and source-backed `dine_in` order type
- sales order list and detail view
- staff customer-order queue at exact `/order` for non-cashier staff
- cashier customer-order queue tab at `/pos?tab=customer-orders`
- staff approval and payment completion for cashier/public orders
- sales POS session list and detail view
- sales promotion creation
- sales promotion deactivation when the current session has sales write coverage across every promotion outlet
- public customer ordering from `/order/{tableToken}`
- public table resolution, menu reads, cart updates, and order submit
- public order-status refresh from `/order/{tableToken}?order={orderToken}`
- admin-only payroll period list and detail view
- admin-only payroll timesheet list and detail view
- admin-only payroll run list and detail view
- admin-only payroll period creation
- admin-only payroll timesheet creation
- admin-only payroll generation and approval
- admin-only finance expense view
- admin-only audit view

### Explicitly blocked or deferred

- control-plane admin console
- promotion editing and lifecycle management beyond create
- broader payroll workflow tooling beyond create/generate/approve
- deeper procurement lifecycle tooling beyond the current queue actions
- frontend exposure of HR contract administration
- public payment in the customer ordering flow
- full cursor/page pagination beyond the current paged `limit + offset` contract

## Accessibility Readiness

- Keyboard-usable login and shell navigation are implemented and tested.
- Form controls are labeled, expose `aria-invalid`, and associate inline validation messaging on login.
- Main workspace uses semantic landmarks:
  - skip link
  - primary nav
  - `main`
- Loading, empty, error, and forbidden states are explicit panels rather than silent blanks.
- Remaining accessibility follow-up:
  - expand keyboard assertions deeper into tables and filters
  - add more route-level accessible-name assertions for newly added pages

## Security Notes

- Frontend calls the gateway only.
- Frontend never sends internal headers.
- UI hiding is never treated as authorization.
- Control-plane remains excluded from the normal frontend.
- Admin-only routes such as finance and audit are blocked both in nav and by route guards, with backend auth remaining authoritative.
- The sidebar only shows modules the current session can actually read today, but several scoped modules remain visible to manager users because the backend still allows those reads on an outlet-scoped basis.
- Cashier-only sessions are intentionally narrowed into the dedicated `/pos` workspace even though the backend still exposes some broader coarse outlet-scoped reads.

## Confidence By Domain

| Domain | Confidence | Notes |
|---|---|---|
| Gateway/auth boundary | High | source and tests are clear |
| Session bootstrap | High | login/me are straightforward |
| Org/outlet scoping | High | source confirms server-side filtering for non-admin users; the frontend still keeps its defensive outlet filter because that behavior is business-critical |
| Product/pricing reads | High | outlet-scoped pricing list now exists |
| Inventory/report reads | High | existing frontend and backend alignment is strong |
| HR read surface | High | shifts plus outlet and personal work-shifts are clear and outlet-scoped |
| Procurement read surface | High | suppliers plus PO/GR/invoice/payment queues and selected queue actions are implemented; broader lifecycle tooling still remains deferred |
| Finance/audit read surface | High | admin-only reads are clear and now backed by real page content, filters, and honest empty states |
| Sales/payroll frontend readiness | High | sales promotion creation/deactivation and admin payroll create/generate/approve flows are now implemented on top of the real backend contracts |
| Cashier sales lifecycle and stock safety | High | stock is validated server-side on create and approval, inventory is consumed at approval, and cashier/public orders now use the explicit `order_created -> order_approved -> payment_done` lifecycle |

## Next Improvements

1. Clarify whether future navigation should become fully permission-granular or keep evolving from the current backend-derived capability matrix.
2. Add generated OpenAPI rather than maintaining the source-derived static contract by hand.
3. Decide when the current paged `limit + offset` envelopes should become full cursor-based pagination on the highest-volume lists.
4. Clarify whether navigation should stay capability-aware plus admin-only or move toward truly permission-granular gating.
5. Decide whether the public POS flow should add public payment beyond the current order-status and order-submission support.
