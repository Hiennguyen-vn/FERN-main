# Changelog — Highland-Clone Sprints 1-3

## Sprint 1 — Production Hardening (V54-V59)

### V54 — `legacy_price` flag
- `core.sale_item.legacy_price BOOLEAN` + `current_price_at_sync NUMERIC` + generated `price_drift_amount`
- `SalesRepository.markPriceDrift(saleId)` — UPDATE flagging stale unit_price vs current product_price
- `SalesRepository.reportPriceDrift(outletIds, from, to, limit)` — drift report for ops
- `SalesService.approveSaleFromSync` runs drift detection post-approve, emits `sale_legacy_price_total` counter
- `GET /api/v1/admin/reports/price-drift?from=&to=&outletId=` — admin endpoint, scope-checked

### V55 — Modifier-aware inventory deduction
- `core.modifier_recipe_effect` — links `modifier_option` → ingredient adjustments
- 4 effect types with deterministic apply order: `MULTIPLY → SCALE_ITEM → SUBSTITUTE → ADD`
- `InventoryRepository.findSaleModifierOptions` + `findModifierRecipeEffects`
- `InventoryService.applySaleApproved` rewrites recipe expansion per-line then applies modifier effects

### V56 — Stock reservation (advisory)
- `core.stock_reservation` — append-only, `(location_id, item_id, qty, sale_id, expires_at, settled_at)`
- `core.stock_available` view — balance − sum(unsettled active reservations)
- `StockReservationService` — reserve / available / settle / sweepExpired (`@Scheduled` 60s)
- Settlement called from `applySaleApproved` after hard deduction
- `POST /api/v1/inventory/reservations` + `GET /api/v1/inventory/stock-available`

### V57 — Cash movement ledger
- `core.cash_movement` — append-only with type enum (OPEN_FLOAT, PAID_IN, PAID_OUT, SALE_CASH, DROP, CLOSE_COUNT)
- `core.cash_session_summary` view — open_float, sales_cash, paid_in/out, drops, counted, expected_total, variance
- `CashMovementService.record / list / summary`
- `POST /api/v1/pos/sessions/{id}/cash-movements` + `GET .../summary`
- `GET /api/v1/admin/reports/cash-summary/{sessionId}`

### V58 — Loyalty MVP
- `crm.customer` — phone, points_balance, consent flags, soft-delete (PDPL right-to-erasure)
- `crm.points_ledger` — append-only, `balance_after` snapshot
- `crm.otp_request` — SHA256-hashed code, 5min TTL
- `LoyaltyService.register / earn / redeem / erase / requestOtp / verifyOtp` (mock OTP "123456")
- `LoyaltyController` at `/api/v1/loyalty`

### V59 — DB hardening
- `fern_app` role: `statement_timeout=30s`, `idle_in_transaction_session_timeout=60s`, `lock_timeout=5s`
- New `fern_report` role: 120s timeout, SELECT-only on core
- `infra/pgbouncer/` — opt-in transaction pool (`pool_mode=transaction`, `max_client_conn=1000`, `default_pool_size=25`)

## Sprint 2 — Sync & Channels Wire

### V60 — Sale-customer link + auto-earn
- `core.sale_record.customer_id` (soft FK) + `points_earned` + `points_redeemed`
- `SalesRepository.linkCustomerToSale / findCustomerIdForSale / findSaleTotal / recordPointsEarned`
- `SalesService.attachCustomer(saleId, customerId)` — `POST /api/v1/sales/orders/{id}/customer`
- `SalesService.autoEarnLoyalty(saleId)` — wired into both `approveSale` + `approveSaleFromSync` paths

### Manifest signing
- `ManifestSigner` — Ed25519 PKCS#8 base64 from `fern.sync.manifest-private-key-pkcs8-b64`
- `SyncDtos.ManifestResponse.signature + keyId`
- Edge `manifest-verify.ts` — WebCrypto Ed25519 verify, public key via `VITE_MANIFEST_PUBKEY`
- `tools/gen-manifest-keypair.sh` — keypair generator

### Edge Dexie sweeper
- Telemetry storage-warning plumbing for client-side storage pressure.
- `use-dexie-sweeper.ts` — leader-tab gated, posts to `/api/v1/telemetry/storage-warning`
- New telemetry endpoints: `/storage-warning`, `/clock-skew`

### DLT replay
- `SalesRepository.listDltPending(limit)` + `requeueDlt(eventId)`
- `GET /api/v1/admin/reports/dlt` + `POST .../dlt/{id}/replay`

## Sprint 3 — Test & UI

### Integration tests
- `PriceDriftIT` — 3 scenarios (no drift, drift detection, report listing) using `PostgresContainerExtension`
- `PostgresContainerExtension` schemas extended to include `crm`

### Unit tests
- `ManifestSignerTest` — 4 tests (disabled fallback, sign+verify roundtrip, version-sensitive, canonical stability)
- `LoyaltyPointsTest` — 3 tests (zero edges, floor logic, constants)

### Frontend admin module
- New `/admin` route (`AdminModule`) with 4 tabs:
  - `PriceDriftPage` — date range filter, drift table
  - `DltReplayPage` — list + replay button per event
  - `CashReconPage` — session lookup + variance display (>50k VND red)
  - `LoyaltyPage` — phone lookup + soft-delete with confirmation

### Test count
| Module | Before | After |
|---|---|---|
| sales-service | 94 unit | 116 (101 unit + 15 IT incl 7 new) |
| inventory-service | 7 | 7 (constructor updated) |

## Known Issues / Carryover

- V42 `sale_inventory_reversal` migration has a pre-existing duplicate-PK conflict on partial-applied DBs. Out-of-scope. Workaround: clean DB or manual repair.
- Existing pre-existing checksum mismatches V6, V33 — fixed via `flyway repair`.
- `INTERNAL_SERVICE_TOKEN` hardcoded fallback still present (not addressed in this scope).

## Out-of-Scope (Tracked in audit.md)

- Channel adapters (Grab/Shopee/Be)
- Real payment gateways (VietQR/MoMo/ZaloPay/VNPay)
- CQT e-invoice sync (Viettel/VNPT/MISA)
- Real SMS OTP gateway
- Helm/Terraform IaC
- Multi-region DR
- KDS / Bar Display
- Recipe variance / food cost dashboards
