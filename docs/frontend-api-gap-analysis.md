# Frontend API Gap Analysis

Last updated: 2026-03-31

This document tracks the gap between the current backend surface and the frontend that exists in `/Users/nguyendinhkhiem/Development/Javas/FERN/frontend`.

Source code is authoritative. When docs and code disagree, code wins.

## Artifact Status Matrix

Current status values:

- `fully frontend-usable now`
- `partially frontend-usable now`
- `intentionally hidden from the frontend`
- `blocked by missing backend API`

| Service | Docs | OpenAPI frontend surface | Frontend API client | Frontend route / screen | Authz / access model captured | Test coverage | Current status | Next action |
|---|---|---|---|---|---|---|---|---|
| Gateway | Done | Done | Done | Done via dashboard diagnostics | Done | Mocked and live | fully frontend-usable now | Keep diagnostics lightweight |
| Auth | Done | Done | Done | Done | Done | Mocked and live | fully frontend-usable now | Keep lifecycle coverage in sync with live auth/session tests |
| Master / control-plane | Done | Excluded by design | Not needed | Excluded by design | Done | Docs only | intentionally hidden from the frontend | Keep excluded unless explicit operator UI is needed |
| Org | Done | Done | Done | Done | Done | Mocked and live | fully frontend-usable now | Keep backend filtering as the primary contract and retain the frontend defense-in-depth filter |
| HR | Done | Done | Done for shifts and work-shifts | Done read-only | Done | Mocked and live | partially frontend-usable now | Add contract admin UI only if explicitly needed |
| Product | Done | Done | Done | Done | Done | Mocked and live | fully frontend-usable now | Pagination later |
| Procurement | Done | Done | Done | Done partial operational | Done | Mocked and live | partially frontend-usable now | Add richer procurement filters, cursor-ready pagination later, and broader lifecycle tooling |
| Sales | Done | Done | Done | Done partial operational + public POS | Done | Mocked and live | partially frontend-usable now | Add richer promotion lifecycle tooling, broader sales workflow actions beyond approve/payment, and optional public payment later |
| Inventory | Done | Done | Done | Done | Done | Mocked and live | fully frontend-usable now | Pagination/filter improvements later |
| Payroll | Done | Done | Done | Done partial operational | Done | Mocked and live | partially frontend-usable now | Add richer admin filters, full pagination, and broader payroll tooling later |
| Finance | Done | Done | Done | Done admin-only | Done | Mocked and live | partially frontend-usable now | Keep paged `limit + offset` envelopes until cursor pagination is justified |
| Audit | Done | Done | Done | Done admin-only | Done | Mocked and live | partially frontend-usable now | Keep paged `limit + offset` envelopes until cursor pagination is justified |
| Report | Done | Done | Done | Done | Done | Mocked and live | fully frontend-usable now | Add richer aggregation endpoints later if needed |

## Service-by-Service Gaps

### Gateway

- Confirmed:
  - `GET /api/v1/gateway/info` is public and safe for frontend diagnostics.
- Gap:
  - no deeper product need right now for `routes` or `targets`.
- Action:
  - keep the frontend on `info` only and document the rest as operational diagnostics.

### Auth

- Confirmed:
  - login, me, refresh, logout, session inventory, and session revocation now support the current frontend pass.
- Gaps:
  - no cookie or refresh-token rotation model
  - no admin session-management console beyond the current user-scoped inventory
- Action:
  - keep the frontend aligned to bearer-token plus current-session inventory semantics

### Master / Control-plane

- Confirmed:
  - routes exist for service inventory, config, releases, and health.
- Gap:
  - these are not a normal user-facing surface and would leak operational internals.
- Action:
  - keep excluded from the main frontend

### Organization

- Confirmed:
  - hierarchy and outlet reads are suitable for the current app shell
  - the frontend safely filters hierarchy payloads to the authenticated `outletIds` before rendering for non-admin users
- Gap:
  - unpaginated lists
- Action:
  - treat the backend filter as the primary contract
  - keep the frontend outlet filter as defense in depth

### HR

- Confirmed:
  - shift list, work-shift-by-outlet/date, and personal work-shift list support a real read-only HR schedule screen
- Gaps:
  - contracts are admin/internal only
  - no broader staff roster read model for a richer HR UI
- Action:
  - keep current screen focused on shifts/work shifts
  - defer contract management

### Product

- Confirmed:
  - products, items, and outlet pricing all support the current read-first UI
- Gap:
  - list endpoints are unpaginated
- Action:
  - document limitation and defer pagination

### Procurement

- Confirmed:
- supplier list and detail are usable now
- purchase-order, goods-receipt, supplier-invoice, and supplier-payment list reads now exist
- selected procurement queue actions now have truthful frontend coverage
- Gaps:
  - no cursor pagination yet; current UI uses paged `limit + offset` envelopes with `totalCount` and `hasNextPage`
  - no full procurement lifecycle console yet
- Action:
  - keep the current queue actions live
  - add broader write flows only when the product/back-end lifecycle contract is explicit enough

### Sales

- Confirmed:
- backend now supports list/search reads for sales orders and POS sessions plus existing sale detail
- backend now supports promotion list/detail reads scoped by outlet overlap
- backend/frontend now support promotion creation through the gateway
- backend/frontend now support scoped promotion deactivation through the gateway
- backend/frontend now support public table-token resolution, menu reads, and customer order submission under `/api/v1/sales/public/**`
- backend/frontend now support public order-status reads under `/api/v1/sales/public/tables/{tableToken}/orders/{orderToken}`
- backend/frontend now support a protected staff customer-order queue at exact `/order`, backed by `publicOrderOnly=true` list reads plus `POST /api/v1/sales/orders/{saleId}/approve`, legacy `POST /api/v1/sales/orders/{saleId}/confirm`, and `POST /api/v1/sales/orders/{saleId}/mark-payment-done`
- backend/frontend now support staff ordering-table link reads through `GET /api/v1/sales/ordering-tables`, which powers client-order URL generation inside the cashier `/pos` workspace
- public QR/table orders and cashier-created orders now use the explicit `order_created -> order_approved -> payment_done` lifecycle
- stock is validated server-side on create and revalidated on approval so orders cannot silently drive stock below zero
- inventory is consumed at approval, not at order creation
- sale completion/payment-captured events now move to the payment-done boundary
- sales order IDs, POS session IDs, and promotion IDs are now string-safe in frontend-facing payloads so 64-bit values stay lossless in the browser
- Gaps:
  - no cursor pagination yet; current UI uses paged `limit + offset` envelopes with `totalCount` and `hasNextPage`
  - no broader promotion edit/delete lifecycle yet
  - no broader cashier workflow actions beyond approve/payment-done
  - no public payment contract yet
- Action:
  - keep the operational sales UI live
  - keep cashier client-order URL generation limited to staff with `sales.order.write` on the requested outlet
  - add richer sales filters and pagination only when real operator usage justifies them
  - keep the current public POS flow limited to table resolution, menu, cart, order submit, and order-status until a real public payment contract exists

### Inventory

- Confirmed:
  - balance and movement reads are sufficient for the current read-only inventory screens
- Gap:
  - unpaginated reads and limited filtering
- Action:
  - acceptable for first pass

### Payroll

- Confirmed:
- periods, timesheets, and payroll runs now have list reads plus existing detail routes
- admin period creation, timesheet creation, payroll generation, and approval now have truthful frontend coverage
- Gaps:
  - no cursor pagination yet; current UI uses paged `limit + offset` envelopes with `totalCount` and `hasNextPage`
  - no richer roster/search read model for a larger payroll console
- Action:
  - keep the current admin operational UI live
  - defer broader payroll operations until the backend contract is clearer

### Finance

- Confirmed:
- `GET /api/v1/finance/expenses` is sufficient for a first admin read screen with outlet/date/source filters
- Gaps:
  - admin-only by role, not outlet-scoped
  - no cursor pagination yet; current UI uses paged `limit + offset` envelopes with `totalCount` and `hasNextPage`
- Action:
  - keep first screen read-only and admin-only

### Audit

- Confirmed:
- recent audit log listing is sufficient for a first admin audit view
- the current frontend can inspect selected row payloads from the list response without needing a separate detail call
- Gaps:
  - no cursor pagination yet; current UI uses paged `limit + offset` envelopes with `totalCount` and `hasNextPage`
  - filter set is still limited for heavier admin investigations
- Action:
  - keep the current recent-activity reader

### Report

- Confirmed:
  - sales, expenses, movements, and low-stock reports cover the current outlet-scoped dashboard and reports UI
- Gaps:
  - no single aggregated cross-region admin endpoint
  - current multi-outlet admin views would need multiple calls or a future aggregated API
- Action:
  - keep the first UI outlet-scoped and explicit about that limit

## Missing APIs Discovered

These are the main remaining gaps after the current read-surface implementation wave:

1. Full cursor pagination on heavier read surfaces
   - current frontend now uses server-backed paged envelopes with `items`, `limit`, `offset`, `totalCount`, and `hasNextPage` for sales, procurement queues, payroll, audit, and finance, but no cursor contract yet
2. Broader promotion, procurement, and payroll lifecycle contracts
   - needed before the frontend should expose deeper edit/posting/approval consoles
3. Truly permission-granular navigation rules
   - the route/nav policy now hides unreadable modules through a backend-derived read matrix, and cashier-only sessions are intentionally narrowed into the dedicated `/pos` workspace
   - backend/product clarification is still needed before finer per-permission gating inside the still-coarse outlet-scoped domains for non-cashier scoped users
4. Public POS payment surface
   - current public customer flow supports table resolution, menu reads, order submission, and public order-status only

## Clarifications Still Needed

1. Navigation granularity
   - The current frontend now uses an explicit backend-derived read-policy map and hides unreadable modules from the staff sidebar entirely.
   - Cashier-only users no longer land in the generic operations console; they are routed directly into the dedicated `/pos` workspace as a frontend product restriction built on top of the existing sales contracts.
   - Product/backend clarification is still needed before making navigation truly permission-granular inside domains where the backend still allows coarse outlet-scoped reads for manager and other scoped users.
2. Public POS follow-up scope
   - Product/backend clarification is still needed before adding payment to the QR/table ordering flow.

## Backend APIs Added In This Pass

1. Auth
   - `POST /api/v1/auth/refresh`
   - `POST /api/v1/auth/logout`
   - `GET /api/v1/auth/sessions`
   - `POST /api/v1/auth/sessions/{sessionId}/revoke`
2. Sales
   - `GET /api/v1/sales/orders`
   - `GET /api/v1/sales/pos-sessions`
   - `GET /api/v1/sales/pos-sessions/{sessionId}`
  - `GET /api/v1/sales/promotions`
  - `GET /api/v1/sales/promotions/{promotionId}`
  - `POST /api/v1/sales/promotions`
  - `POST /api/v1/sales/promotions/{promotionId}/deactivate`
  - `POST /api/v1/sales/orders/{saleId}/approve`
  - `POST /api/v1/sales/orders/{saleId}/confirm`
  - `POST /api/v1/sales/orders/{saleId}/mark-payment-done`
  - `GET /api/v1/sales/public/tables/{tableToken}`
  - `GET /api/v1/sales/public/tables/{tableToken}/menu`
  - `POST /api/v1/sales/public/tables/{tableToken}/orders`
  - `GET /api/v1/sales/public/tables/{tableToken}/orders/{orderToken}`
  - tightened outlet/admin read auth on `GET /api/v1/sales/orders/{saleId}`
3. Payroll
   - `GET /api/v1/payroll/periods`
   - `GET /api/v1/payroll/timesheets`
   - `GET /api/v1/payroll`
   - `POST /api/v1/payroll/periods`
   - `POST /api/v1/payroll/timesheets`
   - `POST /api/v1/payroll`
   - `POST /api/v1/payroll/{payrollId}/approve`
4. Procurement
   - `GET /api/v1/procurement/purchase-orders`
   - `GET /api/v1/procurement/goods-receipts`
   - `GET /api/v1/procurement/invoices`
   - `GET /api/v1/procurement/payments`
   - `POST /api/v1/procurement/purchase-orders/{purchaseOrderId}/approve`
   - `POST /api/v1/procurement/goods-receipts/{receiptId}/approve`
   - `POST /api/v1/procurement/goods-receipts/{receiptId}/post`
   - `POST /api/v1/procurement/invoices/{invoiceId}/approve`
   - `POST /api/v1/procurement/payments`
   - `POST /api/v1/procurement/payments/{paymentId}/post`
  - `POST /api/v1/procurement/payments/{paymentId}/cancel`
  - `POST /api/v1/procurement/payments/{paymentId}/reverse`
5. Paged list envelopes
  - paged `items` / `limit` / `offset` / `totalCount` / `hasNextPage` envelopes now back the current high-volume sales, procurement, payroll, finance, and audit list endpoints so the frontend no longer fakes large-list paging client-side

## Security Notes

- Control-plane remains excluded from the normal frontend surface.
- Finance and audit stay admin-only in both docs and UI route guards.
- Outlet-scoped services remain outlet-scoped in the frontend and backend.
- The frontend still relies on backend authorization as the source of truth.
- The sidebar no longer renders `READ` / `Manage` / `Admin` badges; visible modules now reflect actual readable surfaces, while action buttons remain separately capability gated.

## Recommended Next Backend Work

1. Add pagination to the heaviest read endpoints after measuring real frontend usage.
2. Add richer read filters where operators will genuinely need them.
3. Add broader promotion, procurement, and payroll lifecycle contracts only after the server rules are explicit enough to keep the UI honest.
4. Clarify future permission-granular navigation before tightening page-level visibility beyond the current backend-derived readable-surface policy map.
