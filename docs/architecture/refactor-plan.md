# FERN Production-Hardening Refactor Plan

> Successor to [IMPROVEMENT_PLAN.md](../IMPROVEMENT_PLAN.md) and [FOLLOWUP_PLAN.md](../FOLLOWUP_PLAN.md). Same execution discipline (one task = one PR, self-contained), but scoped at architecture-level: takes the system from "feature-rich modular monolith" to "production-grade for hundreds of outlets".
>
> Anchored to [ADR-0002 — Shared schema with read boundaries](../adr/0002-shared-schema-with-read-boundaries.md) and the architecture review of 2026-05-01.

## How agents use this doc

1. Pick first task with status `[ ]`. Tasks within a wave are ordered; do not skip.
2. Read **Why → Evidence → Scope → Files → Acceptance → Verify**.
3. Implement behind feature flag whenever the task changes a hot path.
4. Update status to `[x]` with commit hash. If blocked, mark `[!]` with reason + owner.
5. Wave gates are mandatory: do not start the next wave until the current wave's gate passes on staging.

Status legend: `[ ]` TODO · `[~]` IN-PROGRESS · `[x]` DONE · `[!]` BLOCKED.

---

## Decisions already locked (2026-05-01)

| Topic | Choice | Rationale |
|---|---|---|
| Inventory ownership | **Reservation pattern** (sales reserves, inventory confirms) | Zero oversell window without giving up service independence. Schema already exists (`V56__stock_reservation.sql`). |
| Internal service auth | **Per-service JWT client credentials** | Reuses `JwtTokenService` + JWKS already deployed; rotates without PKI churn. mTLS deferred to W5 as defence-in-depth. |
| Reporting projection | **Stream Kafka → ClickHouse** for realtime, with Postgres materialized fallback | ClickHouse already in `infra/clickhouse`. Realtime <30s for hundreds of outlets. |
| Roadmap entry | **Wave 0 first** | Foundation invariants (event identity, ownership, business_date) before any other refactor. |

---

## Evidence index — what this plan is fixing

| Concern | Evidence in repo |
|---|---|
| `SalesRepository` 3356 LOC | `services/sales-service/src/main/java/com/fern/services/sales/infrastructure/SalesRepository.java` |
| `InventoryRepository` 1726 LOC | `services/inventory-service/src/main/java/com/fern/services/inventory/infrastructure/InventoryRepository.java` |
| `FinanceRepository` 1007 LOC | `services/finance-service/src/main/java/com/fern/services/finance/infrastructure/FinanceRepository.java` |
| Sales writes inventory directly | `SalesRepository.java:1808-1843` (`SELECT … FROM core.stock_balance … FOR UPDATE`) — duplicates `InventoryEventConsumer.applySaleApproved` |
| Outbox event id is regenerated on every publish | `TypedKafkaEventPublisher.publishInternal:56-58` (`UUID.randomUUID()`); `OutboxRelay.publishEvent:139-142` does not pass an id |
| Consumer idempotency keyed on regenerated id | `InventoryEventConsumer.java:74` (`envelope.eventId()`) |
| Internal auth = single shared token | `InternalServiceAuth.java:90-94`, `SpringInternalServiceAuth.java:54-56` |
| Gateway route classification hardcoded | `GatewayAuthenticationFilter.isPublicPath/isDevicePath` vs prefix-string switch in `GatewayRoutesConfiguration.routePolicy` |
| Telemetry route absent | No entry in `GatewayRouteCatalog.routes()`; no `TelemetryController` on POS edge |
| Manifest fail-open in dev | `FERN-pos-edge/agent/src/services/manifest-verifier.ts:56-58` (`if (!key) return true`) |
| Report uses `DATE(created_at)` | `ReportRepository.java:47, 61, 391, 397` |
| HA gaps | `infra/docker-compose.yml` has 1 manual postgres-replica, no Patroni; no service replica counts; no chaos suite |

---

## Wave map

| Wave | Goal | Sprints | Gate |
|---|---|---|---|
| W0 | Stop the bleeding: stable event identity, single inventory writer, business_date | S1 | Replay + chaos test in staging |
| W1 | Service identity & gateway enforcement | S2-S3 | Shared token usage = 0 in prod metrics |
| W2 | Repository decomposition (Sales/Inventory/Finance) | S3-S5 | All repo IT green; `SalesRepository` < 500 LOC façade |
| W3 | POS edge consistency | S4-S5 | Manifest fail-closed; recipe modifier parity test |
| W4 | Reporting projection (ClickHouse) | S5-S7 | Report-service has zero `core.*` reads |
| W5 | Production readiness (HA, chaos, migration safety) | S6-S8 | Full chaos suite green for 7 days |

Critical-path dependency: **W0.1 must land before W3.4** (POS edge already uses outbox.id as eventId; central must too) and before W4.x (replay storms during projection backfill).

---

# Wave 0 — Stop the bleeding

> Goal: invariants that protect data integrity at hundreds-of-outlets scale, without changing service boundaries.

## Task W0.1 — Stable outbox event identity [ ]

**Why**: Each `OutboxRelay.publishEvent` call generates a fresh `UUID.randomUUID()` envelope id. When the relay reclaims a stale `PROCESSING` row (`OutboxRelay.java:88-95`) or the same row is republished after a Kafka ack timeout, consumers see two envelopes with the **same business event** but different `eventId`. `IdempotencyGuard` keys on `envelope.eventId()` and treats them as distinct events ⇒ double stock deduction, double GL posting.

**Evidence**:
- `common/service-common/src/main/java/com/fern/common/spring/events/TypedKafkaEventPublisher.java:56-58`
- `common/service-common/src/main/java/com/fern/common/outbox/OutboxRelay.java:139-142`
- `services/inventory-service/src/main/java/com/fern/services/inventory/application/InventoryEventConsumer.java:74`

**Decision**: derive a deterministic UUIDv5 from `core.outbox_event.id` (existing snowflake BIGINT) at publish time. **No schema change** — the wire format stays UUID, consumers don't need migration. Idempotency key on consumer side becomes `envelope.eventId() + ':' + envelope.aggregateId()` to disambiguate per-aggregate.

> Rejected alternative: add `event_uuid UUID` column on `core.outbox_event`. Outbox is partitioned and hot — avoid an `ADD COLUMN NOT NULL DEFAULT` storm. Deterministic derivation gives the same guarantee for free.

**Scope**:
- New `UuidV5.fromOutboxId(long id)` utility (FERN namespace UUID hardcoded constant).
- `OutboxRelay.publishEvent` computes `eventId = UuidV5.fromOutboxId(event.id())`, passes through.
- New publisher overload `publishAndAwaitWithId(eventId, topic, aggregateId, eventType, payload, traceId)`. Existing `publishAndAwait` stays for non-outbox callers (synchronous emit) but is annotated deprecated when used outside outbox path.
- Every `*EventConsumer` switches idempotency key to composite.

**Files**:
- New: `common/service-common/src/main/java/com/fern/common/util/UuidV5.java`
- `common/service-common/src/main/java/com/fern/common/outbox/OutboxRelay.java`
- `common/service-common/src/main/java/com/fern/common/spring/events/TypedKafkaEventPublisher.java`
- `services/inventory-service/src/main/java/com/fern/services/inventory/application/InventoryEventConsumer.java`
- `services/finance-service/src/main/java/com/fern/services/finance/application/FinanceEventConsumer.java`
- `services/audit-service/src/main/java/com/fern/services/audit/application/AuditEventConsumer.java`
- Tests: `OutboxRelayTest`, `InventoryEventConsumerTest`, `FinanceEventConsumerTest`, `AuditEventConsumerTest`

**Acceptance**:
- Replay test: same outbox row published twice yields the same `envelope.eventId`.
- Reclaim test: kill relay between `publishEvent` and `markPublished` ⇒ next relay publishes again ⇒ `core.processed_events` has exactly one `result_status='SUCCESS'` row for that idempotency key.
- All existing consumer ITs green with composite key.

**Verify**:
```bash
mvn -pl common/service-common,services/inventory-service,services/finance-service,services/audit-service test
mvn -pl services/inventory-service verify -Dgroups=outbox-replay
```

---

## Task W0.2 — Sales reads stock without locking [ ]

**Why**: Pre-condition for W0.3 (reservation rollout). Today `SalesRepository.loadStockByItem(...lockRows=true)` holds row locks on `core.stock_balance` during sale create — blocks the inventory consumer when it tries to apply movements after `sale-approved`. Once reservations are the source of available stock, sales must read without locking.

**Evidence**: `SalesRepository.java:1803-1844`.

**Decision**: introduce `availableForOutlet(outletId, itemIds)` returning `qty_on_hand − reserved_qty` from inventory side, expose via internal HTTP. Sales calls this in **read mode** for precheck. Toggle via `sales.inventory.read-mode={direct|service}`; `direct` keeps current code path, `service` calls inventory-service.

**Scope**:
- Add method to `services/inventory-service/src/main/java/com/fern/services/inventory/application/StockReservationService.java` (or new `StockAvailabilityService`).
- Internal endpoint `GET /api/v1/inventory/stock-availability?outletId=&itemIds=` returning `[{itemId, available}]`.
- Sales client wrapper in `services/sales-service/.../infrastructure/InventoryAvailabilityClient.java`.
- Feature flag `sales.inventory.read-mode` defaults to `direct` in this PR.

**Files**:
- `services/inventory-service/src/main/java/com/fern/services/inventory/application/StockAvailabilityService.java` *(new)*
- `services/inventory-service/src/main/java/com/fern/services/inventory/api/InventoryController.java`
- `services/sales-service/src/main/java/com/fern/services/sales/infrastructure/InventoryAvailabilityClient.java` *(new)*
- `services/sales-service/src/main/java/com/fern/services/sales/infrastructure/SalesRepository.java` (loadStockByItem path)
- Tests: `StockAvailabilityServiceTest`, contract test sales↔inventory.

**Acceptance**:
- With `read-mode=service`, sales precheck still detects oversell on identical fixtures (regression-equal to `read-mode=direct`).
- p95 latency of `POST /api/v1/sales/orders` does not regress > 20 ms in load test.

**Verify**:
```bash
mvn -pl services/inventory-service,services/sales-service test
ENABLE_SERVICE_READ_MODE=true ./scripts/load-test-sales-orders.sh
```

---

## Task W0.3 — Reservation pattern: single inventory writer [ ]

**Why**: Eliminate dual-write. Sales must not touch `stock_balance`. Inventory must be the only writer of `inventory_movement` and `stock_balance`.

**Evidence**: `SalesRepository.java:1808-1843` directly updates stock; `InventoryEventConsumer.applySaleApproved` (line 78) also deducts ⇒ during retry/reclaim windows, both run.

**Decision**: sales writes `core.stock_reservation` (schema from `V56__stock_reservation.sql`) inside the order-create transaction. The `pos.sale.approved` event consumer:

1. looks up reservation by `sale_id`;
2. confirms reservation → appends `inventory_movement`;
3. updates `stock_balance`;
4. releases reservation row (terminal state).

`pos.sale.cancelled` consumer releases reservation without movement.

Available qty (used by W0.2) = `stock_balance.qty_on_hand − active_reservations.qty`.

**Rollout**: feature flag `sales.reservation.enabled` per outlet. Soak each tier (1 outlet → 10 outlets → region → all) for 24 h with diff job comparing legacy and new stock totals. Post-cutover wait 2 weeks before deleting legacy code path.

**Scope**:
- New `services/inventory-service/.../infrastructure/StockReservationRepository.java` methods: `reserve()`, `confirm()`, `release()`, `expireStale()`.
- `SalesRepository` order-create path: replace stock-balance update with `reservationRepo.reserve(...)`. Outbox event payload unchanged (consumer infers reservation by `saleId`).
- `InventoryEventConsumer.applySaleApproved` rewrites to consume reservation.
- Background job `StockReservationExpiryJob` — release reservations older than configurable TTL (default 30 min) for sales not approved.
- Diff job `scripts/inventory-reservation-diff.sql` — compare reservation-driven vs legacy stock totals per outlet.

**Files**:
- `services/inventory-service/src/main/java/com/fern/services/inventory/infrastructure/StockReservationRepository.java`
- `services/inventory-service/src/main/java/com/fern/services/inventory/application/StockReservationService.java`
- `services/inventory-service/src/main/java/com/fern/services/inventory/application/InventoryEventConsumer.java`
- `services/inventory-service/src/main/java/com/fern/services/inventory/application/StockReservationExpiryJob.java` *(new)*
- `services/sales-service/src/main/java/com/fern/services/sales/infrastructure/SalesRepository.java`
- Migration: none (V56 already defines `stock_reservation`); add a covering index if profiling demands.
- Tests: `OrderLifecycleReservationIT`, `InventoryEventConsumerReservationIT`, chaos test "consumer-lag-30s".

**Acceptance**:
- End-to-end fixture: order create → approve → consumer apply → final `stock_balance.qty_on_hand` matches expected; only one `inventory_movement` row.
- Concurrency: 10 parallel orders for the same item with stock = 5 ⇒ exactly 5 succeed, 5 fail with oversell guard.
- Chaos: consumer paused 30 s ⇒ second concurrent order sees reservation, gets oversell rejection. After consumer resumes, no double-deduct.
- Diff job: zero variance on 7-day staging soak.
- Code path metric `sales_legacy_stock_write_total` = 0 once flag flipped.

**Verify**:
```bash
mvn -pl services/inventory-service,services/sales-service verify
docker compose -f infra/docker-compose.yml -f infra/chaos/inventory-lag.yml up --abort-on-container-exit
psql -f scripts/inventory-reservation-diff.sql
```

---

## Task W0.4 — Reports use `business_date` [ ]

**Why**: `DATE(created_at)` is wall-clock UTC; outlets close shift at 03:00 local — sales after midnight roll into the wrong business day for night shifts and outlets in non-UTC timezones.

**Evidence**: `services/report-service/src/main/java/com/fern/services/report/infrastructure/ReportRepository.java:47, 61, 391, 397`.

**Scope**:
- Replace `DATE(created_at)` with `business_date` in all four call sites.
- Audit `core.sale`, `core.payment`, `core.expense_document` for missing `business_date` columns; backfill where needed.
- Sales-service insert path: ensure `business_date` is computed from outlet timezone + cutoff (default 03:00) at insert. Helper: `BusinessDateResolver.resolve(saleInstant, outletTimezone, cutoff)`.
- Backfill migration: `Vxx__backfill_business_date.sql` for any historical rows where `business_date IS NULL`.

**Files**:
- `services/report-service/src/main/java/com/fern/services/report/infrastructure/ReportRepository.java`
- `services/sales-service/src/main/java/com/fern/services/sales/infrastructure/SalesRepository.java` (insert paths)
- `common/service-common/src/main/java/com/fern/common/util/BusinessDateResolver.java` *(new)*
- `db/migrations/Vxx__backfill_business_date.sql` *(new)*
- Tests: `BusinessDateResolverTest`, `ReportRepositoryBusinessDateIT`.

**Acceptance**:
- Sale instant `2026-05-02T02:30+07:00`, cutoff 03:00 ⇒ `business_date = 2026-05-01`.
- Existing P&L report on 7-day staging: variance vs old `DATE(created_at)` < 0.01 % during off-hours, expected drift only on cross-midnight transactions.

**Verify**:
```bash
mvn -pl services/report-service,services/sales-service test
psql -f db/tests/business_date_smoke.sql
```

---

## Wave 0 gate (must pass before W1)

| Check | How |
|---|---|
| Replay storm test | Dump 24 h of `fern.sales.*` topics, replay; idempotency holds, stock totals stable. |
| Reservation diff | `scripts/inventory-reservation-diff.sql` returns zero variance on staging for 7 days. |
| `business_date` parity | Old vs new report variance ≤ 0.01 % (excluding designed cross-midnight cases). |
| Production metrics | `sales_legacy_stock_write_total = 0` in canary outlets for 24 h. |

---

# Wave 1 — Service identity & gateway enforcement

## Task W1.1 — Per-service JWT client credentials [ ]

**Why**: A single `INTERNAL_SERVICE_TOKEN` shared across all services is a fan-out blast radius. The allowlist (`INTERNAL_SERVICE_ALLOWLIST`) only checks the self-asserted `X-Internal-Service` header.

**Evidence**: `common/service-common/src/main/java/com/fern/common/auth/InternalServiceAuth.java:90-94`, `common/service-common/src/main/java/com/fern/common/spring/auth/SpringInternalServiceAuth.java:54-56`.

**Decision**: each service gets its own JWT minted by auth-service with `aud=<callee>`, `scope=<endpoint capability>`, TTL ≤ 10 min, signed with rotating keys served via existing `/.well-known/jwks.json`.

**Scope**:
- Auth-service endpoint `POST /api/v1/auth/internal/token` — issues JWT for caller (caller authenticates with bootstrap secret per service, stored in Vault).
- New verifier `SpringInternalJwtAuth` — verifies JWT, checks `aud == self`, scope contains required capability.
- `SpringInternalServiceAuth` retained as **fallback verifier** behind `internal.auth.allow-shared-token` flag, default `true` during rollout, flip to `false` post-cutover.
- Per-route scope declaration via annotation `@RequiresInternalScope("inventory:stock-read")` on Spring controllers.
- Policy file `common/service-common/src/main/resources/internal-service-policy.yaml` — declarative `caller → callee → scopes` matrix; verified at boot.

**Files**:
- `services/auth-service/spring/src/main/java/com/fern/services/auth/spring/api/InternalTokenController.java` *(new)*
- `common/service-common/src/main/java/com/fern/common/spring/auth/SpringInternalJwtAuth.java` *(new)*
- `common/service-common/src/main/java/com/fern/common/spring/auth/RequiresInternalScope.java` *(new)*
- `common/service-common/src/main/resources/internal-service-policy.yaml` *(new)*
- `gateway/src/main/java/com/fern/gateway/security/GatewayAuthenticationFilter.java` (forwards JWT, no longer attaches shared token)
- Tests: `SpringInternalJwtAuthTest`, contract tests for each service's `/internal/*` endpoints.

**Acceptance**:
- Forging `X-Internal-Service: inventory-service` without a valid JWT ⇒ 401.
- JWT with `aud=finance-service` calling inventory ⇒ 403.
- All inter-service calls show JWT in metric `internal_auth_method{type="jwt"}` after cutover; `shared_token` count → 0.
- Key rotation: revoke old kid, services pick up new keys within JWKS cache TTL (≤ 5 min).

**Verify**:
```bash
mvn -pl services/auth-service,common/service-common test
./scripts/jwt-rotation-smoke.sh
```

---

## Task W1.2 — Gateway route catalog with classification [ ]

**Why**: Route security tier and rate-limit policy live in two different places (`GatewayAuthenticationFilter.isPublicPath/isDevicePath` and `GatewayRoutesConfiguration.routePolicy`), both hardcoded. New routes drift silently.

**Evidence**: `gateway/src/main/java/com/fern/gateway/routing/GatewayRouteCatalog.java`, `gateway/src/main/java/com/fern/gateway/security/GatewayAuthenticationFilter.java:166-179`, `gateway/src/main/java/com/fern/gateway/config/GatewayRoutesConfiguration.java:109-118`.

**Scope**:
- Extend `GatewayRoute` with `RouteClass {PUBLIC, USER, DEVICE, INTERNAL_ONLY}` and `RateLimitTier {DEFAULT, AUTH, SYNC, REPORT, TELEMETRY}`.
- `GatewayAuthenticationFilter` consults catalog instead of `startsWith` checks.
- `GatewayRoutesConfiguration.routePolicy` reads `route.rateLimitTier()` instead of prefix switch.
- Add `/api/v1/telemetry → sales-service` (or future fleet-service) as `DEVICE`/`TELEMETRY`.
- Snapshot test: serialize catalog to JSON, compare against `gateway/src/test/resources/route-catalog.snapshot.json` — review-friendly when adding routes.
- Snapshot test: classification ↔ filter behaviour parity (`PUBLIC` routes pass without auth; `DEVICE` routes accept device tokens; `INTERNAL_ONLY` routes reject browser tokens).

**Files**:
- `gateway/src/main/java/com/fern/gateway/routing/GatewayRoute.java`
- `gateway/src/main/java/com/fern/gateway/routing/GatewayRouteCatalog.java`
- `gateway/src/main/java/com/fern/gateway/security/GatewayAuthenticationFilter.java`
- `gateway/src/main/java/com/fern/gateway/config/GatewayRoutesConfiguration.java`
- `gateway/src/test/resources/route-catalog.snapshot.json` *(new)*
- Tests: `GatewayRouteCatalogSnapshotTest`, `GatewayAuthenticationFilterClassificationTest`.

**Acceptance**:
- Snapshot test fails if a route is added/removed/reclassified — forces explicit review.
- Adding telemetry route works with no further filter edits.
- Rate-limit applied per tier verified by integration test against Redis-backed limiter.

**Verify**:
```bash
mvn -pl gateway test -Dtest='GatewayRouteCatalogSnapshotTest,*ClassificationTest'
```

---

## Task W1.3 — Identity-aware rate limiting [ ]

**Why**: `resolveRateLimitKey` already supports `svc:`/`user:`/`ip:`. Add `device:<deviceId>` so a single misbehaving terminal cannot exhaust an outlet's quota.

**Scope**:
- Extend `GatewayRoutesConfiguration.resolveRateLimitKey` to recognise `X-Internal-Device-Id` (already set by `GatewayAuthenticationFilter` for device tokens).
- Define per-tier limits in config; `TELEMETRY` tier higher than `SYNC` because heartbeats are denser.

**Files**:
- `gateway/src/main/java/com/fern/gateway/config/GatewayRoutesConfiguration.java`
- Tests: `GatewayRateLimitKeyTest`.

**Acceptance**:
- Two devices in same outlet hammering the gateway ⇒ rate limited independently, outlet's other devices unaffected.

---

# Wave 2 — Repository decomposition

> Refactor only. No business behaviour change. Each PR keeps the legacy class as a façade until callers are migrated.

## Task W2.1 — Split `SalesRepository` [ ]

**Target decomposition**:

| New repository | Responsibility | Approx LOC |
|---|---|---|
| `OrderLifecycleRepository` | create / approve / cancel / void; line items; oversell flag | ~700 |
| `PaymentRepository` (extend existing `SalesPaymentRepository`) | capture / refund / reconcile | ~500 |
| `SalesSessionRepository` (existing) | open/close session, reconciliation | unchanged |
| `SalesReadRepository` | list / search / projections (no writes) | ~400 |
| `SyncIngestRepository` | POS-edge push staging, dedup | ~300 |
| `CrmRepository` (existing pattern) | CRM tables | unchanged |
| `SalesPromotionRepository` (existing) | promotion application | unchanged |

**Constraints**:
- Each PR ≤ 500 lines diff; one repository extracted per PR.
- `SalesRepository` becomes a façade delegating to the new repos. Façade is removed only after all callers are migrated.
- Every move must preserve `RequestUserContext` plumbing for RLS.

**Acceptance per PR**:
- All existing `services/sales-service` tests green.
- `wc -l SalesRepository.java` decreases monotonically across PRs; final ≤ 500.

## Task W2.2 — Split `InventoryRepository` [ ]

| New repository | Responsibility |
|---|---|
| `StockBalanceRepository` | sole writer of `core.stock_balance` |
| `StockMovementRepository` | append-only `core.inventory_movement`, lot/FIFO logic |
| `StockReservationRepository` (from W0.3) | reservation lifecycle |
| `StockCountRepository` | physical count, variance |
| `RecipeApplicationRepository` | resolve recipe, compute deductions |

## Task W2.3 — Split `FinanceRepository` [ ]

| New repository | Responsibility |
|---|---|
| `InvoiceRepository` (existing) | unchanged |
| `GLRepository` | journal entries, posting |
| `ExpenseRepository` | expense documents |
| `FinanceReadRepository` | reporting joins |

---

# Wave 3 — POS edge consistency

## Task W3.1 — Manifest fail-closed [ ]

**Why**: `manifest-verifier.ts` returns `true` when no public key is configured. In production this silently disables manifest signature checks.

**Evidence**: `FERN-pos-edge/agent/src/services/manifest-verifier.ts:56-58`.

**Scope**:
- New env `MANIFEST_VERIFY_REQUIRED=true` (forced `true` in production build profile, default `false` only in dev).
- When `required=true && publicKey == null` ⇒ throw at agent startup.
- When `required=true && envelope.signature == null` ⇒ reject manifest, log alert, do not apply.

**Files**:
- `FERN-pos-edge/agent/src/services/manifest-verifier.ts`
- `FERN-pos-edge/agent/test/manifest-verifier.test.ts`

**Acceptance**:
- Agent in `production` profile without key fails to start with explicit error.
- Manifest with wrong `kid` is rejected; counter `pos_manifest_reject_total{reason="kid-mismatch"}` increments.

---

## Task W3.2 — Recipe modifier consistency at POS edge [ ]

**Why**: Modifiers (`V70`, `V55`) can change required ingredient quantities (e.g. extra cheese ⇒ +30 g). POS edge `recipe-puller.ts` only pulls base recipe and components — when offline, deductions diverge from central recalculation.

**Scope**:
- Extend `GET /api/v1/sync/pull/recipes` to include `modifierEffects[]` per recipe.
- POS edge schema migration: `recipe_modifier_effect (recipe_product_id, modifier_id, item_id, qty_delta, ...)`.
- `recipe-puller.ts` upserts modifier effects.
- Local sales path applies modifier deltas when computing offline deductions.
- Parity test: same order with same modifiers, applied offline at POS and recomputed at central, produces identical `inventory_movement` rows.

**Files**:
- `services/sales-service/src/main/java/com/fern/services/sales/api/SyncController.java` (or recipe pull endpoint)
- `FERN-pos-edge/agent/src/services/recipe-puller.ts`
- `FERN-pos-edge/agent/src/db/migrations/0xx_recipe_modifier_effect.sql`
- `FERN-pos-edge/agent/src/services/sales-service.ts` (deduction path)
- E2E: `FERN-pos-edge/e2e/recipe-modifier-parity.spec.ts`.

**Acceptance**: parity diff = 0 across 100 randomly generated orders with modifiers.

---

## Task W3.3 — Telemetry & fleet health [ ]

**Why**: No telemetry route, no fleet dashboard. Operations cannot tell which terminals are stuck offline or behind on sync.

**Scope**:
- Backend route `/api/v1/telemetry` (added in W1.2).
- POS-edge agent emits heartbeat every 60 s with: `device_id`, `outbox_lag_count`, `oldest_pending_age_seconds`, `last_sync_attempt_at`, `recipe_version`, `manifest_kid`, `local_disk_free_bytes`, `app_version`.
- Backend stores in `core.device_heartbeat` (partitioned daily, retention 30 d).
- Grafana dashboard `infra/grafana/dashboards/fleet-health.json`.
- Alerts: outlet with > 50 % terminals at outbox lag > 5 min; any terminal with manifest mismatch.

**Files**:
- `services/sales-service/src/main/java/com/fern/services/sales/api/TelemetryController.java`
- `services/sales-service/src/main/java/com/fern/services/sales/application/TelemetryService.java`
- `db/migrations/Vxx__device_heartbeat.sql`
- `FERN-pos-edge/agent/src/services/telemetry-emitter.ts` *(new)*
- `infra/grafana/dashboards/fleet-health.json`
- `infra/prometheus/alerts/fleet-lag.yml`

---

## Task W3.4 — POS-edge outbox identity parity [ ]

**Why**: POS-edge already uses `outbox.id` as `eventId` (`FERN-pos-edge/agent/src/services/outbox-relay.ts:146`). After W0.1, the central side must accept this id as the canonical idempotency key — verify no UUID regeneration happens on the central ingest path.

**Scope**: regression test only (`SyncIngestServiceIT`) — push the same `eventId` twice ⇒ exactly one `core.processed_events` row.

---

# Wave 4 — Reporting projection (ClickHouse)

## Task W4.1 — Kafka → ClickHouse stream [ ]

**Why**: Realtime reporting at hundreds of outlets cannot be served by `core.*` joins. ClickHouse is already in `infra/clickhouse`.

**Scope**:
- Kafka Connect sink job consuming `fern.sales.sale-completed`, `fern.sales.payment-captured`, `fern.inventory.movement`, `fern.finance.posted`.
- ClickHouse target tables: `fern.sales_completed`, `fern.payment_captured`, `fern.inventory_movement`, `fern.gl_posted` — partitioned by `business_date`, ordered by `(outlet_id, business_date, …)`.
- Retention: 90 d hot, 1 y cold (S3-backed).

**Files**:
- `infra/kafka-connect/clickhouse-sink-sales.json`
- `infra/clickhouse/migrations/Vxx__report_streams.sql`
- Test: `infra/scripts/test-clickhouse-stream.sh`.

**Acceptance**: an event published in Kafka is queryable in ClickHouse within 30 s p95.

## Task W4.2 — Report-service reads from ClickHouse only [ ]

**Why**: After W4.1 stabilises, remove cross-domain `core.*` reads from report-service to satisfy ADR-0002 strict mode.

**Scope**:
- `ReportRepository` queries replaced with ClickHouse queries (via JDBC ClickHouse driver).
- Lifeline: if projection lag > 10 min, fall back to `core.*` with `WARN` log + alert.
- Database permission: revoke `SELECT ON core.*` from `report_service_user` after audit log shows zero usage for 4 weeks.

**Files**:
- `services/report-service/pom.xml` (add ClickHouse JDBC)
- `services/report-service/src/main/java/com/fern/services/report/infrastructure/ReportRepository.java`
- New: `ClickHouseReportRepository`, `ProjectionLagDetector`.

**Acceptance**: p95 latency for daily P&L < 1 s on 6 months of data.

## Task W4.3 — Postgres materialized fallback [ ]

**Why**: Belt-and-braces for during ClickHouse incidents.

**Scope**:
- Materialized views `report.daily_outlet_sales`, `report.daily_outlet_expense`, `report.daily_item_movement`.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` cron every 5 min.
- Used only when ClickHouse circuit breaker open.

---

# Wave 5 — Production readiness

## Task W5.1 — Postgres HA via Patroni [ ]

**Scope**: 3-node Patroni + etcd DCS + HAProxy. Connection strings split into `pg-write` and `pg-read` backends. PgBouncer in transaction-pooling for hot services, session-pooling where `LISTEN/NOTIFY` is used.

**Acceptance**: kill primary ⇒ leader election + new primary in ≤ 30 s; service reconnect ≤ 60 s; outbox loses zero messages.

## Task W5.2 — Kafka 3 brokers + Redis HA in production topology [ ]

**Scope**: lift from `infra/docker-compose.yml` (already 3 brokers, RF=3) into Helm/Strimzi. Redis Sentinel cluster of 3 nodes for rate-limit and cache.

## Task W5.3 — Service replicas + HPA [ ]

**Scope**:
- K8s manifests with ≥ 2 replicas per service.
- HPA on `kafka_consumer_lag` (consumer-heavy services) and CPU 60 %.
- Readiness probe checks DB + Kafka producer; liveness only for process health.

## Task W5.4 — Migration safety [ ]

**Scope**:
- `db/scripts/migrate.sh` runs **dry-run** stage on a `pg_basebackup`-cloned staging DB before deploy; deploy blocks on failure.
- Every migration has a paired `Vxx__name.rollback.sql` (or documented manual procedure).
- Style enforcement: `CREATE INDEX CONCURRENTLY`; reject `ALTER TABLE … ADD COLUMN NOT NULL DEFAULT` on tables > 10 GB unless author signs off in PR.

## Task W5.5 — Lock & deadlock observability [ ]

**Scope**:
- Prometheus exporter for `pg_locks` by mode, `pg_stat_activity.wait_event_type='Lock'` p95.
- `pg_stat_statements` daily top-10; query plans persisted to `db/query-plans/<date>/`.
- Alert: deadlock rate > 1/min for 5 min.

## Task W5.6 — Chaos suite [ ]

**Scope**: weekly run in staging.
- Kafka outage (kill 1 broker).
- Postgres failover (Patroni demote).
- Network partition POS edge ↔ central.
- Replay storm (24 h topic dump replayed).

**Acceptance**: each scenario passes its assertion (no lost data, recovery within SLO, idempotency holds).

---

## Risk register

| Risk | Wave | Mitigation |
|---|---|---|
| W0.1 lands without W0.3 ⇒ dedup is sharper but dual-write still double-deducts | W0 | Ship W0.1, W0.2, W0.3 within the same sprint; do not enable reservation default until all three are merged. |
| W2.x refactors break RLS | W2 | RLS test suite (`db/tests/`) must stay green per PR. Add session-GUC assertion to repo unit tests. |
| W1.1 cut-over leaves a service still on shared token | W1 | Metric `internal_auth_method{type="shared_token"}` alarmed weekly during rollout; cut-over only when zero for 7 days. |
| W4.2 revoke `SELECT ON core.*` breaks ad-hoc analyst queries | W4 | Audit `pg_stat_statements` for `report_service_user` for 4 weeks; communicate with analytics team before revoke. |
| W5.1 Patroni rollout regression | W5 | ≥ 4 weeks staging soak; chaos suite green for 7 consecutive days before prod. |

---

## Out of scope (tracked elsewhere)

- mTLS service identity (defence-in-depth) — backlog after W1.1 stable.
- Separate database per service — explicitly rejected by ADR-0002 at current scale.
- Multi-region active-active — see [multi-region-design.md](../multi-region-design.md).
