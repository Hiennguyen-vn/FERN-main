# README_API.md

Last updated: 2026-03-31

This document is the current HTTP API contract for the FERN backend. It is grounded in the code that exists in this repository today.

Frontend startup companion:

- [frontend-startup.md](/Users/nguyendinhkhiem/Development/Javas/FERN/docs/frontend-startup.md)
- [frontend-surface.json](/Users/nguyendinhkhiem/Development/Javas/FERN/docs/openapi/frontend-surface.json)

The first real browser app now lives at:

- `/Users/nguyendinhkhiem/Development/Javas/FERN/frontend`

## 1. Public Entry Points

Use the Gateway only.

- HTTP base URL (local): `http://127.0.0.1:8180`
- Gateway service info:
  - `GET /api/v1/gateway/routes`
  - `GET /api/v1/gateway/targets`
  - `GET /api/v1/gateway/info`
- Gateway health:
  - `GET /health/live`
  - `GET /health/ready`

Clients and test suites should not call internal domain services directly unless a test explicitly chooses direct mode.

## 1.1 Runtime Modes

FERN is strict by default.

- Starting services without `--dev` keeps dev-only behavior disabled.
- Dev-only behavior is enabled only when the JVM process is started with `--dev`.
- Environment labels alone do not enable dev mode.

Local launcher behavior:
- `bash ./infra/scripts/restart-services.sh` => strict mode
- `bash ./infra/scripts/restart-services.sh --dev` => explicit dev mode
- `bash ./infra/scripts/test-all-endpoints.sh` => direct-service suite
- `bash ./infra/scripts/test-all-endpoints.sh --gateway` => gateway suite
- `bash ./infra/scripts/test-all-endpoints.sh --dev` => explicit dev behavior enabled for tests
- `bash ./infra/scripts/test-all-endpoints.sh --gateway --dev` => gateway routing plus explicit dev behavior

`--gateway` only changes routing.
`--dev` only enables explicit dev-mode runtime/test behavior.

Gateway smoke-test behavior:
- strict `--gateway` mode expects `401` on protected unauthenticated probe paths
- local HS256 JWTs signed with `JWT_SECRET` are used in some local smoke checks as a test convenience in both strict and dev modes
- `--gateway --dev` still uses a locally signed JWT for synthetic routed probe checks and expects routed nonexistent probe paths to return downstream `404`

## 2. Security and Exposure Rules

- External authentication is JWT-based.
- Protected HTTP routes expect `Authorization: Bearer <jwt>`.
- Gateway strips client-supplied `X-Internal-*` headers before proxying.
- Gateway returns `401` for protected routes when no valid Bearer JWT is present.
- Gateway injects trusted `X-Internal-*` headers only after JWT verification and preserves `X-Gateway-Upstream-Service` on routed responses.
- Gateway intentionally leaves `/api/v1/sales/public/**` public for the customer QR/table-ordering flow; those routes remain table-token scoped and must not expose staff or control-plane behavior.
- Gateway-forwarded user requests remain user-scoped downstream. They do not become privileged internal-service calls just because the gateway injected trusted headers.
- Internal service calls rely on shared service-to-service headers injected by trusted components only.
- Browser/mobile clients must not call internal service ports directly.
- Control-plane routes are operational/admin routes and should not be treated as normal frontend surface area.
- `stock_balance` is read-only from the application perspective. Inventory writes must go through `inventory_transaction`.
- Outlet-scoped IAM remains authoritative for outlet-bound operations.

## 3. Common Contract Conventions

### 3.1 Auth Contract

- Auth service login endpoint: `POST /api/v1/auth/login`
- JWT is returned by the auth service and then sent by clients as:

```http
Authorization: Bearer <jwt>
```

- Downstream services receive user context from the shared authentication filter and shared internal-auth propagation.

### 3.2 Headers

- `Authorization: Bearer <jwt>` for authenticated external requests
- `Content-Type: application/json` for JSON request bodies
- Optional: `X-Correlation-ID: <client-trace-id>`
- Internal-only forwarded headers are injected by trusted gateway/service code, not by clients
- Gateway may forward verified user identity, roles, permissions, and outlet scope in trusted headers, but downstream business authorization still evaluates that request as the originating user
- Any client-supplied `X-Internal-*` headers are stripped at the gateway boundary

### 3.3 Standard HTTP error shape

FERN services use a stable JSON error shape:

```json
{
  "timestamp": "2026-03-28T00:00:00Z",
  "error": "validation_error",
  "message": "Human-readable message",
  "details": [
    {
      "field": "username",
      "message": "must not be blank",
      "code": "NotBlank"
    }
  ]
}
```

Notes:
- validation failures return `error: "validation_error"` and include `details`
- malformed JSON returns `error: "invalid_json"`
- generic `500` responses do not expose Java causes or stack traces to clients

### 3.4 Idempotency

HTTP write APIs are not yet uniformly exposing a public idempotency header contract.

Kafka event consumers that mutate data use the shared `idempotency-core` guard where implemented:
- Finance event consumers
- Inventory event consumers
- Audit event consumers

### 3.5 Paged frontend list contract

The heavier frontend list surfaces now use a shared paged JSON envelope instead of raw arrays:

```json
{
  "items": [],
  "limit": 50,
  "offset": 0,
  "totalCount": 0,
  "hasNextPage": false
}
```

Current scope:
- sales order, POS-session, and promotion lists
- procurement purchase-order, goods-receipt, invoice, and payment lists
- payroll period, timesheet, and payroll-run lists
- finance expense list
- audit log list

This is still an offset-based contract, not final cursor pagination.

## 4. HTTP API

## 4.0 Frontend Surface Snapshot

| Service | Frontend visibility | Current frontend status | Notes |
|---|---|---|---|
| Gateway | public diagnostics | Implemented | dashboard reads `GET /api/v1/gateway/info` only |
| Auth | public + authenticated | Implemented | login, refresh, logout, and user-scoped session lifecycle |
| Master / control-plane | excluded | Not exposed | operational/admin only |
| Org | authenticated | Implemented | hierarchy and outlet reads, with defensive client-side outlet filtering for scoped users |
| HR | authenticated, outlet-scoped | Implemented read-only | shifts, outlet schedule, and personal work-shift reads; contracts remain admin/internal |
| Product | authenticated | Implemented | catalog, items, pricing |
| Procurement | authenticated, scoped | Implemented partial operational | supplier list/detail plus PO, goods receipt, invoice, and payment queue reads, offset-based windowing, and selected queue actions |
| Sales | authenticated, scoped, plus public customer ordering | Implemented partial operational + public POS | order, POS session, promotion, cashier `/pos`, and staff customer-order queue reads, offset-based windowing, stock-safe order create/approve/payment lifecycle, promotion creation/deactivation, and public table-scoped ordering via `/api/v1/sales/public/**` |
| Inventory | authenticated, outlet-scoped | Implemented read-mostly operational | balance/detail reads plus waste and stock-count operations; direct balance editing stays unavailable |
| Payroll | admin only | Implemented partial operational | period, timesheet, and payroll-run list/detail reads plus admin create/generate/approve actions |
| Finance | admin only | Implemented read + create | filtered expense ledger, expense detail, and operating/other expense creation |
| Audit | admin only | Implemented read-only | filterable audit feed with detail inspection |
| Report | authenticated, outlet-scoped | Implemented read-only | date-filtered sales and expense summaries, item-filtered movement summaries, and low-stock snapshot |

Frontend visibility note:
- the staff shell now hides unreadable modules from navigation based on the backend-derived read contract for each route
- this is still not a fully permission-granular UX because many backend read surfaces remain coarse outlet-scoped reads for cashier and manager users
- the sidebar no longer renders `READ`, `Manage`, or `Admin` badges; backend authorization and route guards remain authoritative

## 4.1 Gateway

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| GET | `/api/v1/gateway/routes` | none | `200` | Returns known route prefixes |
| GET | `/api/v1/gateway/targets` | none | `200` | Returns resolved downstream targets |
| GET | `/api/v1/gateway/info` | none | `200` | Gateway runtime information |
| GET | `/health/live` | none | `200` | Liveness probe |
| GET | `/health/ready` | none | `200` | Readiness probe |

Gateway route prefixes:
- `/api/v1/auth/**`
- `/api/v1/master/**`
- `/api/v1/control/**`
- `/api/v1/org/**`
- `/api/v1/hr/**`
- `/api/v1/product/**`
- `/api/v1/products/**`
- `/api/v1/procurement/**`
- `/api/v1/sales/**`
- `/api/v1/crm/**`
- `/api/v1/inventory/**`
- `/api/v1/payroll/**`
- `/api/v1/finance/**`
- `/api/v1/audit/**`
- `/api/v1/report/**`
- `/api/v1/reports/**`

Frontend note:
- Gateway is the only browser-facing backend boundary.
- Control-plane prefixes route through the gateway for operations, but they remain excluded from the normal frontend product surface.

## 4.2 Auth

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | Public | `200` | Returns JWT login response |
| GET | `/api/v1/auth/me` | JWT | `200` | Current authenticated user summary |
| POST | `/api/v1/auth/refresh` | JWT | `200` | Refresh the active session token |
| POST | `/api/v1/auth/logout` | JWT | `200` | Revoke the active session |
| GET | `/api/v1/auth/sessions` | JWT | `200` | List the current user's known sessions |
| POST | `/api/v1/auth/sessions/{sessionId}/revoke` | JWT | `200` | Revoke a specific session owned by the caller |
| POST | `/api/v1/auth/users` | JWT admin/outlet-scoped auth | `201` | Create user |
| GET | `/api/v1/auth/users` | JWT admin/outlet-scoped auth | `200` | List users with optional outlet/status/username filters (paged) |
| GET | `/api/v1/auth/scopes` | JWT admin/outlet-scoped auth | `200` | List outlet scope assignments (roles + direct permissions) (paged) |
| GET | `/api/v1/auth/overrides` | JWT admin/outlet-scoped auth | `200` | List direct user-permission overrides by outlet (paged) |
| GET | `/api/v1/auth/permissions` | JWT admin/outlet-scoped auth | `200` | Permission catalog feed (`code/name/description/module/assignedRoleCount`) (paged) |
| GET | `/api/v1/auth/roles` | JWT admin/outlet-scoped auth | `200` | Role catalog feed (`code/name/description/status/assignedPermissionCount`) (paged) |
| PUT | `/api/v1/auth/roles/{roleCode}/permissions` | JWT admin | `200` | Replace role permissions |

Auth session notes:
- `POST /api/v1/auth/refresh` revokes the current session and issues a new session ID plus access token
- `POST /api/v1/auth/logout` revokes the currently authenticated session only
- `GET /api/v1/auth/sessions` returns both current and revoked sessions for the caller so the frontend can show recent session history

## 4.3 Master Node

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| POST | `/api/v1/master/heartbeat` | Internal service | `200` | Compatibility heartbeat endpoint |
| GET | `/api/v1/master/registry/{serviceName}` | Internal service | `200` | Active instances for a service |
| POST | `/api/v1/control/services/register` | Internal service | `201` | Register service instance |
| POST | `/api/v1/control/services/{instanceId}/heartbeat` | Internal service | `200` | Heartbeat/update service instance |
| POST | `/api/v1/control/services/{instanceId}/deregister` | Internal service | `202` | Mark service offline |
| GET | `/api/v1/control/services` | JWT admin or internal | `200` | Operational inventory, not normal frontend surface |
| GET | `/api/v1/control/services/{serviceName}/instances` | JWT admin or internal | `200` | Operational inventory, not normal frontend surface |
| GET | `/api/v1/control/config/{serviceName}` | JWT admin or internal | `200` | Effective config |
| GET | `/api/v1/control/assignments/{serviceName}` | JWT admin or internal | `200` | Region/outlet assignments |
| GET | `/api/v1/control/health/system` | JWT admin or internal | `200` | System health aggregate |
| GET | `/api/v1/control/health/services/{serviceName}` | JWT admin or internal | `200` | Per-service health |
| POST | `/api/v1/control/releases` | JWT admin or internal | `201` | Create release metadata |
| POST | `/api/v1/control/releases/{releaseId}/rollouts` | JWT admin or internal | `201` | Start rollout metadata |
| GET | `/api/v1/control/releases/{releaseId}` | JWT/internal | `200` | Get release metadata |

The `/api/v1/master/*` aliases exist for compatibility on a subset of control-plane routes.

## 4.4 Organization

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| GET | `/api/v1/org/regions` | JWT/internal | `200` | List regions |
| GET | `/api/v1/org/regions/{code}` | JWT/internal | `200` | Get region by code |
| GET | `/api/v1/org/outlets` | JWT/internal | `200` | List outlets; currently unpaginated |
| GET | `/api/v1/org/outlets/{outletId}` | JWT/internal | `200` | Get outlet by ID |
| GET | `/api/v1/org/hierarchy` | JWT/internal | `200` | Region + outlet hierarchy; source confirms non-admin users are filtered server-side to allowed outlets and visible ancestor regions, and the frontend keeps an extra client-side filter as defense in depth |
| GET | `/api/v1/org/exchange-rates` | JWT/internal | `200` | Exchange-rate lookup |
| POST | `/api/v1/org/outlets` | JWT admin | `201` | Create outlet |
| PUT | `/api/v1/org/exchange-rates` | JWT admin | `200` | Upsert exchange rate |

## 4.5 HR

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| POST | `/api/v1/hr/shifts` | JWT outlet-scoped HR write | `201` | Create shift |
| GET | `/api/v1/hr/shifts/{shiftId}` | JWT outlet-scoped HR read | `200` | Get shift |
| GET | `/api/v1/hr/shifts` | JWT | `200` | List shifts, optional outlet filter |
| PUT | `/api/v1/hr/shifts/{shiftId}` | JWT outlet-scoped HR write | `200` | Update shift |
| DELETE | `/api/v1/hr/shifts/{shiftId}` | JWT outlet-scoped HR write | `204` | Soft-delete shift |
| POST | `/api/v1/hr/work-shifts` | JWT outlet-scoped HR write | `201` | Assign work shift |
| GET | `/api/v1/hr/work-shifts/{workShiftId}` | JWT outlet-scoped HR read | `200` | Get work shift |
| GET | `/api/v1/hr/work-shifts` | JWT | `200` | List by user/date; used by the current frontend for personal work-shift reads |
| GET | `/api/v1/hr/time-off` | JWT | `200` | Time-off/leave feed derived from `work_shift` rows with `attendance_status = leave` (paged) |
| GET | `/api/v1/hr/work-shifts/outlet/{outletId}/date/{date}` | JWT outlet-scoped HR read | `200` | List outlet schedule |
| PUT | `/api/v1/hr/work-shifts/{workShiftId}/attendance` | JWT outlet-scoped HR write | `200` | Update attendance |
| POST | `/api/v1/hr/work-shifts/{workShiftId}/approve` | JWT outlet-scoped HR write | `200` | Approve shift assignment |
| POST | `/api/v1/hr/work-shifts/{workShiftId}/reject` | JWT outlet-scoped HR write | `200` | Reject shift assignment |
| POST | `/api/v1/hr/contracts` | JWT admin/internal | `201` | Create contract |
| GET | `/api/v1/hr/contracts/{contractId}` | JWT admin/internal | `200` | Get contract |
| GET | `/api/v1/hr/contracts/user/{userId}` | JWT admin/internal | `200` | List contracts by user |
| GET | `/api/v1/hr/contracts/active` | JWT admin/internal | `200` | Active contracts |
| GET | `/api/v1/hr/contracts/user/{userId}/latest` | JWT admin/internal | `200` | Latest active contract |
| PUT | `/api/v1/hr/contracts/{contractId}` | JWT admin/internal | `200` | Update contract |
| POST | `/api/v1/hr/contracts/{contractId}/terminate` | JWT admin/internal | `200` | Terminate contract |

## 4.6 Product

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| GET | `/api/v1/product/products` | JWT/internal | `200` | List products; currently unpaginated |
| POST | `/api/v1/product/products` | JWT product write | `201` | Create product |
| GET | `/api/v1/product/items` | JWT/internal | `200` | List items; currently unpaginated |
| POST | `/api/v1/product/items` | JWT product write | `201` | Create item |
| GET | `/api/v1/product/prices/{productId}` | JWT/internal | `200` | Price lookup by outlet/date |
| GET | `/api/v1/product/prices` | JWT/internal | `200` | Current price list by outlet/date |
| PUT | `/api/v1/product/prices` | JWT product write | `200` | Upsert outlet price |
| GET | `/api/v1/product/recipes/{productId}` | JWT/internal | `200` | Resolve recipe |
| PUT | `/api/v1/product/recipes/{productId}` | JWT product write | `200` | Upsert recipe |

## 4.7 Procurement

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| POST | `/api/v1/procurement/suppliers` | JWT procurement write | `201` | Create supplier |
| GET | `/api/v1/procurement/suppliers/{supplierId}` | JWT procurement read | `200` | Get supplier; used by the current frontend detail panel |
| GET | `/api/v1/procurement/suppliers` | JWT procurement read | `200` | List suppliers for the first procurement frontend pass |
| PUT | `/api/v1/procurement/suppliers/{supplierId}` | JWT procurement write | `200` | Update supplier |
| POST | `/api/v1/procurement/purchase-orders` | JWT procurement write | `201` | Create PO |
| GET | `/api/v1/procurement/purchase-orders` | JWT procurement read | `200` | List POs by outlet, supplier, status, and date window; `limit` defaults to `50` and caps at `100` |
| GET | `/api/v1/procurement/purchase-orders/{purchaseOrderId}` | JWT procurement read | `200` | Get PO |
| POST | `/api/v1/procurement/purchase-orders/{purchaseOrderId}/approve` | JWT procurement approve | `200` | Approve PO |
| POST | `/api/v1/procurement/goods-receipts` | JWT procurement write | `201` | Create goods receipt |
| GET | `/api/v1/procurement/goods-receipts` | JWT procurement read | `200` | List goods receipts by outlet, PO, status, and date window; `limit` defaults to `50` and caps at `100` |
| GET | `/api/v1/procurement/goods-receipts/{receiptId}` | JWT procurement read | `200` | Get goods receipt |
| POST | `/api/v1/procurement/goods-receipts/{receiptId}/approve` | JWT procurement write | `200` | Mark receipt received |
| POST | `/api/v1/procurement/goods-receipts/{receiptId}/post` | JWT procurement write | `200` | Post receipt and publish inventory event |
| POST | `/api/v1/procurement/invoices` | JWT procurement write | `201` | Create supplier invoice |
| GET | `/api/v1/procurement/invoices` | JWT procurement read | `200` | List supplier invoices by outlet, supplier, status, invoice date window, and due date; `limit` defaults to `50` and caps at `100` |
| GET | `/api/v1/procurement/invoices/{invoiceId}` | JWT procurement read | `200` | Get invoice |
| POST | `/api/v1/procurement/invoices/{invoiceId}/approve` | JWT procurement approve | `200` | Approve invoice and publish finance event |
| POST | `/api/v1/procurement/payments` | JWT procurement write | `201` | Create supplier payment |
| GET | `/api/v1/procurement/payments` | JWT procurement read | `200` | List supplier payments by outlet, supplier, status, and time window; `limit` defaults to `50` and caps at `100` |
| GET | `/api/v1/procurement/payments/{paymentId}` | JWT procurement read | `200` | Get supplier payment |
| POST | `/api/v1/procurement/payments/{paymentId}/post` | JWT procurement write | `200` | Post payment |
| POST | `/api/v1/procurement/payments/{paymentId}/cancel` | JWT procurement write | `200` | Cancel payment |
| POST | `/api/v1/procurement/payments/{paymentId}/reverse` | JWT procurement write | `200` | Reverse payment |

Procurement read notes:
- admins, superadmins, and trusted internal callers may read any outlet
- scoped non-admin users may read only the outlets present in `RequestUserContext.outletIds()`
- invoice, payment, and goods-receipt list auth resolves outlet scope through their purchase-order and receipt relationships
- procurement queue list endpoints now accept `limit` plus `offset` for windowed frontend tables
- the current frontend now uses supplier, PO, goods-receipt, invoice, and payment reads plus selected queue actions
- supplier payment IDs are serialized as strings in frontend-facing responses so payment follow-up actions can safely round-trip large IDs through the browser

## 4.8 Sales

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| GET | `/api/v1/sales/public/tables/{tableToken}` | Public table token | `200` | Resolve customer-safe table and outlet context for QR ordering |
| GET | `/api/v1/sales/public/tables/{tableToken}/menu` | Public table token | `200` | List customer-orderable menu items for the table's outlet and business date |
| POST | `/api/v1/sales/public/tables/{tableToken}/orders` | Public table token | `201` | Submit a customer table order without staff login; rejects unavailable or insufficient-stock items with `409` |
| GET | `/api/v1/sales/public/tables/{tableToken}/orders/{orderToken}` | Public table token + opaque order token | `200` | Read the public status/receipt for a previously submitted table order |
| POST | `/api/v1/sales/pos-sessions` | JWT sales write | `201` | Open POS session |
| GET | `/api/v1/sales/pos-sessions` | JWT outlet-scoped read or admin/internal | `200` | List POS sessions by outlet, business date or date window, status, and manager; `limit` defaults to `50` and caps at `100` |
| GET | `/api/v1/sales/pos-sessions/{sessionId}` | JWT outlet-scoped read or admin/internal | `200` | Get POS session |
| POST | `/api/v1/sales/pos-sessions/{sessionId}/close` | JWT sales write | `200` | Close POS session |
| POST | `/api/v1/sales/pos-sessions/{sessionId}/reconcile` | JWT sales write on the session outlet or admin/internal | `200` | Reconcile a closed POS session, persist method-level expected/actual totals, and transition session status to `reconciled` |
| GET | `/api/v1/sales/ordering-tables` | JWT sales write on the requested outlet or admin/internal | `200` | List public-safe ordering-table links for cashier POS workflows by outlet and optional table status |
| GET | `/api/v1/sales/ordering-tables/{tableToken}` | JWT sales scoped read/write or admin/internal | `200` | Load a single ordering-table management record |
| POST | `/api/v1/sales/ordering-tables` | JWT sales write on outlet or admin/internal | `201` | Create a new ordering-table link with generated public token |
| PUT | `/api/v1/sales/ordering-tables/{tableToken}` | JWT sales write on table outlet or admin/internal | `200` | Update table display name and/or status (`active`, `unavailable`, `archived`) |
| POST | `/api/v1/sales/orders` | JWT sales write | `201` | Create a stock-validated cashier/staff order in `order_created`; payment is not accepted inline |
| GET | `/api/v1/sales/orders` | JWT outlet-scoped read or admin/internal | `200` | List sales orders by outlet, date window, order status, payment status, POS session, and `publicOrderOnly`; `limit` defaults to `50`, caps at `100`, and supports `offset` |
| GET | `/api/v1/sales/orders/{saleId}` | JWT outlet-scoped read or admin/internal | `200` | Get sale |
| POST | `/api/v1/sales/orders/{saleId}/approve` | JWT sales write on the sale outlet or admin/internal | `200` | Approve an `order_created` cashier/public order; rechecks stock and posts inventory usage |
| POST | `/api/v1/sales/orders/{saleId}/confirm` | JWT sales write on the sale outlet or admin/internal | `200` | Legacy public-order approval alias for customer-submitted table orders; now approves into `order_approved` |
| POST | `/api/v1/sales/orders/{saleId}/mark-payment-done` | JWT sales write on the sale outlet or admin/internal | `200` | Mark an `order_approved` order as paid; captures payment and finalizes the sale in `payment_done` |
| POST | `/api/v1/sales/orders/{saleId}/cancel` | JWT sales write on the sale outlet or admin/internal | `200` | Cancel an `order_created`/`open` order; approved and paid orders are rejected with `409` |
| GET | `/api/v1/sales/promotions` | JWT outlet-scoped read or admin/internal | `200` | List promotions by outlet, status, and effective timestamp; `limit` defaults to `50`, caps at `100`, and supports `offset` |
| GET | `/api/v1/sales/promotions/{promotionId}` | JWT outlet-scoped read or admin/internal | `200` | Get promotion |
| POST | `/api/v1/sales/promotions` | JWT sales write | `201` | Create promotion |
| POST | `/api/v1/sales/promotions/{promotionId}/deactivate` | JWT sales write across all scoped promotion outlets | `200` | Deactivate a draft/active promotion |

Sales lifecycle and stock notes:
- `/api/v1/sales/public/**` is intentionally public and exists only for the dedicated customer-ordering route
- public customer ordering uses opaque `tableToken` values instead of exposing raw table IDs in the URL
- public table routes return `404` for unknown tokens or orders and `409` for unavailable tables or unavailable items
- public order-status uses an opaque `orderToken`, not the internal sale ID
- order lifecycle is now `order_created -> order_approved -> payment_done`
- public customer QR orders and cashier-created POS orders are created as `status = order_created`
- `POST /api/v1/sales/orders` requires an effective outlet-scoped product price for every order line at order date; missing pricing returns `404` (`No effective product price ...`)
- stock availability is validated on order creation and revalidated on approval before inventory is consumed
- inventory is consumed at approval by inserting `sale_usage` inventory transactions; the database now rejects any movement that would drive `stock_balance.qty_on_hand` below zero
- `POST /api/v1/sales/orders/{saleId}/approve` rejects invalid transitions, out-of-scope access, and insufficient stock with `409`
- `POST /api/v1/sales/orders/{saleId}/mark-payment-done` is the payment boundary and requires an approved order
- `POST /api/v1/sales/orders/{saleId}/confirm` remains for the protected public-order queue route, but now maps to approval instead of directly completing the sale
- `POST /api/v1/sales/orders/{saleId}/cancel` only supports pre-approval orders (`open` / `order_created`); cancellation after approval/payment is intentionally blocked with `409`
- `POST /api/v1/sales/pos-sessions/{sessionId}/reconcile` is allowed only for `closed` sessions, writes reconciliation totals, and transitions the session to `reconciled`
- admins, superadmins, and trusted internal callers may read any outlet
- scoped non-admin users may read only the outlets present in `RequestUserContext.outletIds()`
- sales reads do not require a write permission string
- promotion reads are allowed only when the selected promotion overlaps the caller's outlet scope, unless the caller is admin or trusted internal
- sales list endpoints now return the shared paged envelope and accept `limit` plus `offset` for windowed frontend tables
- cashier-only frontend sessions now land in the dedicated `/pos` workspace instead of the generic operations console
- the dedicated cashier checkout uses the existing `POST /api/v1/sales/orders` contract and maps quick sales to the source-backed `dine_in` order type
- the dedicated cashier `/pos` workspace can now list outlet ordering tables and generate/copy the public customer route at `/order/{tableToken}` without exposing raw table IDs
- exact `/order` remains the protected staff customer-order queue for non-cashier staff, while cashier-only sessions are redirected to `/pos?tab=customer-orders`
- `/order/{tableToken}` remains the public QR/table route
- promotion deactivation requires sales write coverage across every outlet attached to the promotion, not only the currently selected outlet
- the current frontend now uses the dedicated cashier `/pos` workspace plus order, POS-session, promotion, and non-cashier staff customer-order queue surfaces, along with order approval, payment completion, promotion creation, and scoped promotion deactivation
- sales order IDs, POS session IDs, and promotion IDs are serialized as strings in frontend-facing responses so 64-bit identifiers remain lossless in the browser
- migration `V12__backfill_missing_outlet_product_pricing.sql` backfills missing active outlet/product pricing + availability coverage for simulator-origin data
- `infra/scripts/verify-pos-pricing-readiness.sh` performs an end-to-end readiness check (login, priced order creation, approval, payment completion, and invalid-combo rejection)

## 4.9 Inventory

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| GET | `/api/v1/inventory/stock-balances/{outletId}/{itemId}` | JWT outlet read | `200` | Get stock balance |
| GET | `/api/v1/inventory/stock-balances` | JWT outlet read | `200` | List stock balances, optional `lowOnly=true` |
| GET | `/api/v1/inventory/transactions` | JWT outlet read | `200` | List movements |
| POST | `/api/v1/inventory/waste` | JWT outlet write | `201` | Record waste transaction |
| POST | `/api/v1/inventory/stock-count-sessions` | JWT outlet write | `201` | Create stock count session |
| GET | `/api/v1/inventory/stock-count-sessions/{sessionId}` | JWT outlet read | `200` | Get stock count session |
| POST | `/api/v1/inventory/stock-count-sessions/{sessionId}/post` | JWT outlet write | `200` | Post stock-count adjustments |

Inventory event consumers:
- `fern.sales.sale-completed`
- `fern.procurement.goods-receipt-posted`

Inventory/sales note:
- sales still emit `fern.sales.sale-completed`, but only after `payment_done`
- synchronous stock consumption for cashier/public orders now happens earlier at order approval, and the inventory consumer remains idempotent for legacy/event-driven paths

## 4.10 Payroll

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| POST | `/api/v1/payroll/periods` | JWT payroll admin | `201` | Create payroll period |
| GET | `/api/v1/payroll/periods` | JWT payroll admin | `200` | List payroll periods by region/date window; `limit` defaults to `50`, caps at `100`, and supports `offset` |
| GET | `/api/v1/payroll/periods/{periodId}` | JWT payroll admin | `200` | Get payroll period |
| POST | `/api/v1/payroll/timesheets` | JWT payroll admin | `201` | Create payroll timesheet |
| GET | `/api/v1/payroll/timesheets` | JWT payroll admin | `200` | List payroll timesheets by period, user, and outlet; `limit` defaults to `50`, caps at `100`, and supports `offset` |
| GET | `/api/v1/payroll/timesheets/{timesheetId}` | JWT payroll admin | `200` | Get payroll timesheet |
| POST | `/api/v1/payroll` | JWT payroll admin | `201` | Generate payroll |
| GET | `/api/v1/payroll` | JWT payroll admin | `200` | List payroll runs by period, user, outlet, and status; `limit` defaults to `50`, caps at `100`, and supports `offset` |
| GET | `/api/v1/payroll/{payrollId}` | JWT payroll admin | `200` | Get payroll |
| POST | `/api/v1/payroll/{payrollId}/approve` | JWT payroll admin | `200` | Approve payroll and emit finance/audit event |

Payroll read notes:
- payroll reads remain admin-only and are not outlet-scoped frontend APIs
- payroll list endpoints now return the shared paged envelope and accept `limit` plus `offset` for windowed frontend tables
- the current frontend now uses period, timesheet, and payroll-run list/detail views plus admin create/generate/approve actions
- payroll period, timesheet, and payroll IDs are serialized as strings in frontend-facing responses and request bodies so 64-bit identifiers remain lossless in the browser

## 4.11 Finance

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| POST | `/api/v1/finance/expenses/operating` | JWT finance admin | `201` | Create operating expense |
| POST | `/api/v1/finance/expenses/other` | JWT finance admin | `201` | Create other expense |
| GET | `/api/v1/finance/expenses/{expenseId}` | JWT finance admin | `200` | Get expense |
| GET | `/api/v1/finance/expenses` | JWT finance admin | `200` | List expenses; current frontend uses outlet/date/source filters, detail readback, and the shared paged envelope with `limit` and `offset` |

Finance event consumers:
- `fern.procurement.invoice-approved`
- `fern.payroll.payroll-approved`

## 4.12 Audit

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| GET | `/api/v1/audit/logs/{auditLogId}` | JWT audit admin | `200` | Get audit log row |
| GET | `/api/v1/audit/logs` | JWT audit admin | `200` | List audit logs; current frontend uses entity/action/actor/date filters, row selection, and the shared paged envelope with `limit` and `offset` |
| GET | `/api/v1/audit/security-events` | JWT audit admin | `200` | Security-focused feed derived from audit logs (paged) |
| GET | `/api/v1/audit/traces` | JWT audit admin | `200` | Audit-backed trace feed exposing correlation/method/path/status when present in event payloads (paged) |

Audit event consumer:
- topic pattern `fern\\..+`

## 4.12.1 CRM

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| GET | `/api/v1/crm/customers` | JWT sales-scoped or admin/internal | `200` | Read-only customer-reference feed derived from public-order tokens (paged) |

## 4.13 Reports

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| GET | `/api/v1/reports/sales` | JWT outlet read | `200` | Sales summary by outlet/date; currently unpaginated |
| GET | `/api/v1/reports/expenses` | JWT outlet read | `200` | Expense summary by outlet/date; currently unpaginated and read-only in the frontend |
| GET | `/api/v1/reports/inventory-movements` | JWT outlet read | `200` | Inventory movement summary with optional `itemId`; currently unpaginated and read-only in the frontend |
| GET | `/api/v1/reports/low-stock` | JWT outlet read | `200` | Low-stock snapshot; currently unpaginated and read-only in the frontend |

## 4.14 Health

Each Spring Boot service also exposes actuator health through its own runtime port, and the gateway exposes:
- `GET /health/live`
- `GET /health/ready`

## 5. Realtime

No public WebSocket contract is implemented in the current FERN repository.

## 6. Internal Service Headers

These are internal only and must not be supplied by external clients:
- service name and shared token headers for service-to-service trust
- forwarded user/session/role/permission headers

Gateway and internal service clients may inject them. External callers must rely on JWT only.

## 7. Idempotent Event Processing

The following consumers currently use shared idempotency enforcement:
- Finance service event consumers
- Inventory service event consumers
- Audit service event consumer

## 8. HTTP Path Index

This is the repository's current HTTP path index. It is not the same thing as the normal frontend surface:
- normal browser/admin frontend traffic should stay on the gateway and use the routes documented in [`frontend-startup.md`](/Users/nguyendinhkhiem/Development/Javas/FERN/docs/frontend-startup.md) and [`frontend-surface.json`](/Users/nguyendinhkhiem/Development/Javas/FERN/docs/openapi/frontend-surface.json)
- control-plane paths remain operational/internal even though they exist in the gateway route table

- `/api/v1/auth/login`
- `/api/v1/auth/me`
- `/api/v1/auth/users`
- `/api/v1/auth/scopes`
- `/api/v1/auth/overrides`
- `/api/v1/auth/permissions`
- `/api/v1/auth/roles`
- `/api/v1/auth/roles/{roleCode}/permissions`
- `/api/v1/master/heartbeat`
- `/api/v1/master/registry/{serviceName}`
- `/api/v1/control/services/register`
- `/api/v1/control/services/{instanceId}/heartbeat`
- `/api/v1/control/services/{instanceId}/deregister`
- `/api/v1/control/services`
- `/api/v1/control/services/{serviceName}/instances`
- `/api/v1/control/config/{serviceName}`
- `/api/v1/control/assignments/{serviceName}`
- `/api/v1/control/health/system`
- `/api/v1/control/health/services/{serviceName}`
- `/api/v1/control/releases`
- `/api/v1/control/releases/{releaseId}/rollouts`
- `/api/v1/control/releases/{releaseId}`
- `/api/v1/org/regions`
- `/api/v1/org/regions/{code}`
- `/api/v1/org/outlets`
- `/api/v1/org/outlets/{outletId}`
- `/api/v1/org/hierarchy`
- `/api/v1/org/exchange-rates`
- `/api/v1/hr/shifts`
- `/api/v1/hr/work-shifts`
- `/api/v1/hr/time-off`
- `/api/v1/hr/contracts`
- `/api/v1/product/products`
- `/api/v1/product/items`
- `/api/v1/product/prices/{productId}`
- `/api/v1/product/recipes/{productId}`
- `/api/v1/procurement/suppliers`
- `/api/v1/procurement/purchase-orders`
- `/api/v1/procurement/purchase-orders/{purchaseOrderId}`
- `/api/v1/procurement/goods-receipts`
- `/api/v1/procurement/goods-receipts/{receiptId}`
- `/api/v1/procurement/invoices`
- `/api/v1/procurement/invoices/{invoiceId}`
- `/api/v1/procurement/payments`
- `/api/v1/procurement/payments/{paymentId}`
- `/api/v1/sales/pos-sessions`
- `/api/v1/sales/pos-sessions/{sessionId}`
- `/api/v1/sales/ordering-tables`
- `/api/v1/sales/ordering-tables/{tableToken}`
- `/api/v1/sales/orders`
- `/api/v1/sales/orders/{saleId}`
- `/api/v1/sales/promotions`
- `/api/v1/sales/promotions/{promotionId}`
- `/api/v1/sales/promotions/{promotionId}/deactivate`
- `/api/v1/sales/public/tables/{tableToken}`
- `/api/v1/sales/public/tables/{tableToken}/menu`
- `/api/v1/sales/public/tables/{tableToken}/orders`
- `/api/v1/inventory/stock-balances`
- `/api/v1/inventory/transactions`
- `/api/v1/inventory/waste`
- `/api/v1/inventory/stock-count-sessions`
- `/api/v1/payroll/periods`
- `/api/v1/payroll/periods/{periodId}`
- `/api/v1/payroll/timesheets`
- `/api/v1/payroll/timesheets/{timesheetId}`
- `/api/v1/payroll`
- `/api/v1/payroll/{payrollId}`
- `/api/v1/finance/expenses`
- `/api/v1/audit/logs`
- `/api/v1/reports/sales`
- `/api/v1/reports/expenses`
- `/api/v1/reports/inventory-movements`
- `/api/v1/reports/low-stock`
- `/api/v1/gateway/routes`
- `/api/v1/gateway/targets`
- `/api/v1/gateway/info`
- `/health/live`
- `/health/ready`

## 9. Future Enhancement Backlog

The following frontend-visible areas are still intentionally bounded by backend domain gaps and are **not** faked in API responses:

- `HR shift-swap workflows`
  - current schema and services expose shifts/work-shifts/time-off reads, but there is no dedicated swap-request aggregate/table with approval and conflict rules
  - recommended next step: add a first-class `shift_swap_request` model plus lifecycle endpoints (`submit`, `approve`, `reject`, `cancel`, `list`)
- `Extended leave/time-off lifecycle`
  - `/api/v1/hr/time-off` now exposes a real leave feed derived from `work_shift.attendance_status = leave`
  - missing pieces: entitlement/quota balance, request drafting, and multi-day leave transaction semantics as first-class domain records
- `Organization branding and global preference writes`
  - current safe settings writes remain `POST /api/v1/org/outlets` and `PUT /api/v1/org/exchange-rates`
  - no backend aggregates exist yet for logo/palette/localization/notification preference persistence
- `POS dine-in table operational workflow parity`
  - read/list/detail + create/update exposure is now available through `/api/v1/sales/ordering-tables*`
  - remaining work is permission-model hardening (`pos.table.*`) and richer table assignment/occupancy orchestration if required by product

## 10. QA Testing Notes

- Preferred local workflow lives under [`infra/README.md`](/Users/nguyendinhkhiem/Development/Javas/FERN/infra/README.md).
- Use:
  - `bash ./infra/scripts/start.sh`
  - `bash ./infra/scripts/start-services.sh`
  - `bash ./infra/scripts/seed-workflow-data.sh`
  - `bash ./infra/scripts/test-all-endpoints.sh`
  - `bash ./infra/scripts/test-all-endpoints.sh --gateway`
  - `bash ./infra/scripts/run-workflow-tests.sh`
  - `bash ./infra/scripts/run-workflow-tests.sh --scenario report-replica`
  - `bash ./infra/scripts/capture-query-plans.sh --target both`
  - `bash ./infra/scripts/collect-observability-snapshot.sh --tag local-check`
- `--gateway` forces HTTP tests through the gateway.
- `--dev` must be passed explicitly to enable dev-only behavior.
- Strict mode is the default; dev mode is never implied.
- `test-all-endpoints.sh --gateway` now includes seeded frontend-critical smoke for login, me, org reads, product reads, report reads, plus one `401` and one `403`.
- Locally signed shared-secret JWTs are used in some local smoke checks as a test convenience, not as a runtime-only dev auth path.
- `run-workflow-tests.sh` validates chained business transactions across auth, org/product, procurement, sales, payroll/finance, audit, and replica-backed reports.
- Query observability for the workflow phase relies on `pg_stat_statements` being enabled on both PostgreSQL primary and replica.
- Frontend mocked and live Playwright suites must be run sequentially on distinct ports, for example `PLAYWRIGHT_PORT=4175 npm run test:e2e` followed by `PLAYWRIGHT_PORT=4176 PLAYWRIGHT_LIVE=1 npm run test:e2e:live`.
