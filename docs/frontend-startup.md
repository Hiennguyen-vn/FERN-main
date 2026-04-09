# Frontend Startup

This document is the single start-here guide for frontend developers working in the in-repo frontend workspace at `/Users/nguyendinhkhiem/Development/Javas/FERN/frontend`.
Use it to run the backend locally, start the frontend, and validate gateway-based integration against seeded demo users.

## 1. What You Are Starting

- Public backend entrypoint: `http://127.0.0.1:8180`
- Public integration surface today:
  - gateway diagnostics
  - auth login, me, refresh, logout, and session management
  - org regions, outlets, hierarchy, exchange rates
  - hr shifts and outlet schedules
  - product catalog, items, prices, recipes
  - procurement supplier reads
  - procurement supplier, purchase-order, goods-receipt, invoice, and payment reads plus queue actions
  - sales order, POS-session, and promotion reads plus promotion creation/deactivation
  - protected staff customer-order queue at exact `/order`
  - public customer table ordering and order-status under `/order/{tableToken}` backed by `/api/v1/sales/public/**`
  - payroll period, timesheet, and payroll-run reads plus admin create/generate/approve actions
  - inventory reads
  - finance expense reads for admins
  - audit log reads for admins
  - report reads
- Not a frontend surface:
  - direct service ports such as `8081`, `8083`, `8085`, `8092`
  - control-plane routes under `/api/v1/control/**` and `/api/v1/master/**`
- deeper lifecycle edits beyond the current promotion, payroll, and procurement operational actions

## 2. Prerequisites

- Java 21
- Maven 3.9+
- Docker with Docker Compose

## 3. Local Startup

1. Copy the infra env file if needed:

```sh
cp infra/.env.example infra/.env
```

2. Start local dependencies:

```sh
./infra/scripts/start.sh
```

3. Start backend services through the local jar launcher:

```sh
./infra/scripts/start-services.sh
```

4. Seed the deterministic local demo data:

```sh
./infra/scripts/seed-workflow-data.sh
```

Important:
- `seed-workflow-data.sh` is destructive to the local FERN database.
- It resets schema state, reapplies migrations, and then applies the workflow/demo seed pack.

5. Start the frontend workspace:

```sh
cd frontend
npm install
npm run dev
```

The in-repo frontend proxies `/api` and `/health` to `http://127.0.0.1:8180` by default.
If your local gateway runs elsewhere, override it explicitly:

```sh
cd frontend
VITE_DEV_PROXY_TARGET=http://127.0.0.1:9191 npm run dev
```

Optional direct-base mode (if you do not want to use proxy forwarding):

```sh
cd frontend
VITE_API_BASE_URL=http://127.0.0.1:8180 npm run dev
```

The default browser URL is:

- `http://127.0.0.1:5173`
- example protected cashier POS workspace after login: `http://127.0.0.1:5173/pos`
- example protected non-cashier staff order queue after login: `http://127.0.0.1:5173/order`
- example public customer ordering URL after seeding: `http://127.0.0.1:5173/order/tbl_hcm1_u7k29q`

## 4. Local Browser Access Strategy

The default local browser workflow uses the Vite dev proxy:

- browser origin: `http://127.0.0.1:5173`
- proxied gateway target: `http://127.0.0.1:8180`

The backend gateway also supports env-driven local browser CORS for alternate dev setups.

Default local example allowlist lives in [services.env.example](/Users/nguyendinhkhiem/Development/Javas/FERN/infra/env/services.env.example):

- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `http://localhost:3000`
- `http://127.0.0.1:3000`

Relevant env keys:

- `GATEWAY_CORS_ALLOWED_ORIGINS`
- `GATEWAY_CORS_ALLOWED_METHODS`
- `GATEWAY_CORS_ALLOWED_HEADERS`
- `GATEWAY_CORS_EXPOSED_HEADERS`

If your frontend runs on a different local origin, override `infra/env/services.env`.

## 5. Demo Users

Seeded demo users come from [010_workflow_validation_seed.sql](/Users/nguyendinhkhiem/Development/Javas/FERN/db/seeds/010_workflow_validation_seed.sql).

Shared password for `workflow.*` users:

- `Workflow#2026!`

Useful accounts:

| Username | Typical use |
|---|---|
| `workflow.admin` | full admin dashboard smoke testing; seeded with every defined outlet role across the workflow outlets |
| `workflow.hcm.manager` | scoped manager authorization testing |
| `workflow.us.manager` | alternate region manager testing |
| `workflow.hcm.cashier` | sales-role testing |

If you manually synced an admin account using:

- `/Users/nguyendinhkhiem/Development/Javas/FERN/db/scripts/ensure_admin_full_access.sh`

then use the exact username/password printed by that script output.

## 6. Login Flow

Authenticate through the gateway:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "workflow.admin",
  "password": "Workflow#2026!"
}
```

The response returns:

- `accessToken`
- `expiresInSeconds`
- user summary
- roles and permissions grouped by outlet

Then call protected routes with:

```http
Authorization: Bearer <accessToken>
```

Get the current authenticated session:

```http
GET /api/v1/auth/me
Authorization: Bearer <accessToken>
```

Current auth flow:

- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/sessions`
- `POST /api/v1/auth/sessions/{sessionId}/revoke`

Frontend code keeps the bearer token in runtime state, restores it from `sessionStorage` on reload, revalidates with `/api/v1/auth/me`, refreshes before expiry, and clears cached scope data on logout or expiry.

## 7. Frontend-Critical Routes Available Now

Gateway base URL:

- `http://127.0.0.1:8180`

Useful reads for the current frontend:

- `GET /api/v1/gateway/info`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/sessions`
- `POST /api/v1/auth/sessions/{sessionId}/revoke`
- `GET /api/v1/org/outlets`
- `GET /api/v1/org/hierarchy`
- `GET /api/v1/hr/shifts?outletId=...`
- `GET /api/v1/hr/work-shifts?startDate=...&endDate=...`
- `GET /api/v1/hr/work-shifts/outlet/{outletId}/date/{date}`
- `GET /api/v1/product/products`
- `GET /api/v1/product/items`
- `GET /api/v1/product/prices?outletId=...&on=...`
- `GET /api/v1/procurement/suppliers?regionId=...&status=...`
- `GET /api/v1/procurement/suppliers/{supplierId}`
- `GET /api/v1/procurement/purchase-orders?outletId=...&status=...&limit=50`
- `GET /api/v1/procurement/goods-receipts?outletId=...&status=...&limit=50`
- `GET /api/v1/procurement/invoices?outletId=...&status=...&limit=50`
- `GET /api/v1/procurement/payments?outletId=...&status=...&limit=50`
- `POST /api/v1/procurement/purchase-orders/{purchaseOrderId}/approve`
- `POST /api/v1/procurement/goods-receipts/{receiptId}/approve`
- `POST /api/v1/procurement/goods-receipts/{receiptId}/post`
- `POST /api/v1/procurement/invoices/{invoiceId}/approve`
- `POST /api/v1/procurement/payments`
- `POST /api/v1/procurement/payments/{paymentId}/post`
- `POST /api/v1/procurement/payments/{paymentId}/cancel`
- `POST /api/v1/procurement/payments/{paymentId}/reverse`
- `GET /api/v1/sales/orders?outletId=...&startDate=...&endDate=...&publicOrderOnly=...&limit=50`
- `GET /api/v1/sales/orders/{saleId}`
- `POST /api/v1/sales/orders/{saleId}/confirm`
- `GET /api/v1/sales/pos-sessions?outletId=...&startDate=...&endDate=...&limit=50`
- `GET /api/v1/sales/pos-sessions/{sessionId}`
- `GET /api/v1/sales/promotions?outletId=...&status=...&effectiveAt=...&limit=50`
- `GET /api/v1/sales/promotions/{promotionId}`
- `POST /api/v1/sales/promotions`
- `GET /api/v1/sales/public/tables/{tableToken}`
- `GET /api/v1/sales/public/tables/{tableToken}/menu`
- `POST /api/v1/sales/public/tables/{tableToken}/orders`
- `GET /api/v1/sales/public/tables/{tableToken}/orders/{orderToken}`
- `GET /api/v1/inventory/stock-balances?outletId=...&lowOnly=...`
- `GET /api/v1/inventory/transactions?outletId=...`
- `GET /api/v1/payroll/periods?limit=50` for admin users
- `GET /api/v1/payroll/timesheets?outletId=...&limit=50` for admin users
- `GET /api/v1/payroll?outletId=...&limit=50` for admin users
- `POST /api/v1/payroll/periods` for admin users
- `POST /api/v1/payroll/timesheets` for admin users
- `POST /api/v1/payroll` for admin users
- `POST /api/v1/payroll/{payrollId}/approve` for admin users
- `GET /api/v1/finance/expenses` for admin users
- `GET /api/v1/audit/logs` for admin users
- `GET /api/v1/reports/sales`
- `GET /api/v1/reports/expenses`
- `GET /api/v1/reports/inventory-movements`
- `GET /api/v1/reports/low-stock`

Public POS notes:

- the customer route is separate from the staff shell and does not require login
- seeded local example token: `tbl_hcm1_u7k29q`
- unavailable table example token: `tbl_hcm1_unavailable_9x2m`

Still intentionally deferred for a real UI:

- promotion editing and lifecycle management beyond create
- broader payroll workflow tooling beyond create/generate/approve
- deeper procurement lifecycle tooling beyond the current queue actions
- public payment in the customer ordering flow

Human-readable contract:

- [README_API.md](/Users/nguyendinhkhiem/Development/Javas/FERN/README_API.md)

Machine-readable contract:

- [frontend-surface.json](/Users/nguyendinhkhiem/Development/Javas/FERN/docs/openapi/frontend-surface.json)

## 8. Error Shape

## 9. Login Troubleshooting

- If `POST /api/v1/auth/login` works directly on gateway but fails from frontend with `404`, frontend routing is misconfigured.
- Ensure frontend runs on `http://127.0.0.1:5173` and Vite proxy is active for `/api` and `/health`.
- If needed, bypass proxy by setting `VITE_API_BASE_URL=http://127.0.0.1:8180`.

Backend JSON errors now follow a stable shape:

```json
{
  "timestamp": "2026-03-28T00:00:00Z",
  "error": "validation_error",
  "message": "Request validation failed",
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

- validation failures use `details`
- malformed JSON returns `error: "invalid_json"`
- generic 500s do not expose Java exception causes to the client

## 9. Current Frontend Integration Limitations

These are real current limitations, not future promises:

- most list endpoints are still unpaginated
- no generated full-repo OpenAPI yet; the current OpenAPI file covers the frontend-critical gateway surface only
- control-plane routes are operational/internal and should not be used by a normal frontend
- the current frontend is still read-first overall; broader write-heavy admin flows are intentionally limited to the implemented operational actions
- org hierarchy is filtered server-side for scoped users and the frontend keeps a defensive client-side filter
- the OpenAPI file is source-derived and maintained in-repo, not generated automatically from annotations

## 10. Useful Validation Commands

Run backend tests:

```sh
mvn test
```

Run frontend checks:

```sh
cd frontend
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run test:e2e
```

Run the live seeded Playwright gateway checks after infra and services are up:

```sh
cd frontend
npm run test:e2e:live
```

Run the gateway-oriented smoke checks, including seeded frontend-critical reads:

```sh
./infra/scripts/test-all-endpoints.sh --gateway
./infra/scripts/test-all-endpoints.sh --gateway --dev
```

Run broader chained workflow validation:

```sh
./infra/scripts/run-workflow-tests.sh --gateway --scenario report-replica
```
