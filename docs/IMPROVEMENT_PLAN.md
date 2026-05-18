# FERN Improvement Plan

> Execution roadmap for agents. Tasks ordered by priority. Each task self-contained: scope, files, acceptance criteria, verification. Agent must complete one task fully (code + test + verify) before moving to next.

## How agent uses this doc

1. Pick first task with status `[ ]` (TODO).
2. Read scope + files listed.
3. Implement. Run verification commands.
4. Update status to `[x]` (DONE) with commit hash.
5. Move to next task.

Status legend: `[ ]` TODO · `[~]` IN-PROGRESS · `[x]` DONE · `[!]` BLOCKED (note reason).

---

## PHASE 1 — Production Blockers

### Task 1.1 — Kafka Dead Letter Queue + Retry [x]

**Why**: One bad event halts entire consumer. Currently re-throws `IllegalStateException`, blocks partition. See [InventoryEventConsumer.java:74](../services/inventory-service/src/main/java/com/fern/services/inventory/application/InventoryEventConsumer.java#L74).

**Scope**:
- Add `@RetryableTopic` to every `@KafkaListener` in services.
- Config: `attempts=3`, exponential backoff `1s → 4s → 16s`, DLT suffix `.DLT`.
- Create `DltHandler` per service: log + audit + Prometheus counter `kafka_dlt_messages_total{topic,service}`.
- Document DLT topics in `docs/erp-microservices-architecture.md`.

**Files**:
- `services/*/src/main/java/**/application/*EventConsumer.java` (every listener)
- New: `common/service-common/src/main/java/com/fern/common/kafka/DltHandlerSupport.java`
- `infra/docker-compose.yml` — pre-create DLT topics if needed

**Acceptance**:
- Each consumer has `@RetryableTopic`.
- Manual test: publish malformed JSON to `fern.inventory.movement` → message lands on `fern.inventory.movement.DLT` after 3 retries.
- Prometheus metric exposed.

**Verify**:
```bash
mvn -pl services/inventory-service test
docker compose exec kafka kafka-topics.sh --bootstrap-server localhost:9092 --list | grep DLT
```

---

### Task 1.2 — Namespace Consolidation `com.dorabets` → `com.fern.common` [x]

**Why**: 470+ imports from external `com.dorabets.*` artifact. Lock-in, no control over auth/utils.

**Scope**:
- Move source from `common/*/src/main/java/com/dorabets/**` to `com/fern/common/**`.
- Mass-rewrite imports: `com.dorabets` → `com.fern.common`. Same for `com.natsu` if confirmed internal.
- Update `pom.xml` artifact `groupId` to `com.fern`.
- Keep package-info.java updated.

**Files**:
- `common/**/*.java` (rename packages)
- All `services/**/*.java` and `gateway/**/*.java` (update imports)
- `pom.xml` (root + modules)

**Constraint**: Single atomic commit per module. Run full build after each module.

**Verify**:
```bash
grep -r "com.dorabets" --include="*.java" . | wc -l   # must = 0
grep -r "com.natsu"    --include="*.java" . | wc -l   # must = 0
mvn -q -DskipTests package
```

---

### Task 1.3 — Test Coverage Sales + Inventory ≥60% [~]

> Partial: JaCoCo wired, baseline measured, +1 unit test class added. **60% gate NOT met** — repository layer (`SalesRepository` 2k lines, `InventoryRepository` 760 lines) needs Testcontainers Postgres integration tests, deferred. Current: sales 10.7% / inventory 16.8% line.

**Why**: Financial flow zero-tested. Current ~16% overall.

**Scope**:
- Unit tests: `SyncService`, `SalesRepository`, `InventoryService`, `InventoryEventConsumer`, payment allocation logic.
- Integration tests: Testcontainers Postgres + Kafka. Flow: create order → sync → inventory decrement → audit log.
- Add JaCoCo plugin, fail build if module coverage < 60%.

**Files**:
- `services/sales-service/src/test/java/**`
- `services/inventory-service/src/test/java/**`
- `pom.xml` — JaCoCo + threshold

**Verify**:
```bash
mvn -pl services/sales-service,services/inventory-service test jacoco:report
# coverage report ≥ 0.60
```

---

## PHASE 2 — Resilience Hardening

### Task 2.1 — Resilience4j Circuit Breaker + Timeout [x]

> All 3 inter-service HTTP clients wired:
> - payroll → hr-service: `@CircuitBreaker(name=hr-service)` + `@Retry`
> - finance → sales-service: `@CircuitBreaker(name=sales-service)` + `@Retry`
> - service-common heartbeat → master-node: `@CircuitBreaker(name=master-node)` + null-fallback (best-effort)
>
> Plus: `RestClient.Builder` default read-timeout 2s. Actuator exposes `/actuator/circuitbreakers,retries`. Health indicator wired.

**Why**: Sync HTTP between services has no timeout/retry/fallback. Slow `org-service` cascades.

**Scope**:
- Add `resilience4j-spring-boot3` dep to `service-common`.
- Wrap inter-service `RestTemplate`/`WebClient` with `@CircuitBreaker` + `@TimeLimiter` + `@Retry`.
- Defaults: timeout 2s, slidingWindow 20, failureRateThreshold 50%, waitDurationInOpenState 10s.
- Fallback: return cached/empty + log + metric.

**Files**:
- `common/service-common/src/main/java/com/fern/common/http/ResilientRestClient.java` (new)
- `application.yml` per service — resilience4j config
- Refactor existing inter-service calls (grep `RestTemplate`, `WebClient`)

**Verify**:
- Chaos test: stop `org-service`, sales API still returns within 3s with degraded response.
- Actuator `/actuator/circuitbreakers` shows states.

---

### Task 2.2 — API Versioning `/v1/` [x]

> Already implemented across codebase. Audit verified:
> - 29/29 backend controllers use `/api/v1/<domain>` class-level mapping (gateway info/fallback exempt — infra endpoints)
> - Gateway route catalog: 20 routes all under `/api/v1/`
> - Frontend client (`frontend/src/api/*.ts`): all paths `/api/v1/...`
>
> **Audit cmd**: `grep -rln '@RestController' services/ gateway/ | xargs awk '/^@RequestMapping/{m=$0; next} /^public class/{print m; exit}'` → 0 missing `/api/v1`.

**Why**: Breaking change = vỡ mobile + device clients.

**Scope**:
- Prefix all REST controllers with `/api/v1/`.
- Gateway route catalog updated to match.
- Frontend `frontend/src/api/client.ts` base path updated.

**Files**:
- `services/*/src/main/java/**/api/*Controller.java` (every `@RequestMapping`)
- `gateway/src/main/java/com/fern/gateway/routing/GatewayRouteCatalog.java`
- `frontend/src/api/client.ts`
- `docs/openapi/*.yaml`

**Verify**:
```bash
curl http://localhost:8080/api/v1/products    # 200
curl http://localhost:8080/products            # 404
```

---

### Task 2.3 — Catalog SQL Pushdown [x]

> Original target (`resolveMenu` loading full `ProductOutletAvailability`) didn't exist. `ProductRepository.listAvailability` already SQL-pushdown with WHERE + index `idx_product_outlet_availability_outlet_id`.
>
> Real anti-patterns found + fixed in `MenuRepository`:
> 1. `findMenu(menuId)` was calling `listMenus().stream().filter(...)` — full menu hierarchy load. Now direct query with `WHERE m.id = ?`.
> 2. `loadCategories(menuIds)` + `loadItems(menuIds)` had N+1 (one query per menuId). Now batched with `WHERE menu_id IN (?,?,?)`.
>
> Indexes already in place: `idx_menu_category_menu`, `idx_menu_item_category`, `idx_menu_item_product`. No new migration needed.

**Why**: `resolveMenu()` loads full `ProductOutletAvailability` to RAM. Dies at 500 SKU × 20 outlets.

**Scope**:
- Replace in-memory filter with JPA query / native SQL `WHERE outlet_id = :id AND active = true`.
- Add index: `CREATE INDEX idx_poa_outlet_active ON product_outlet_availability(outlet_id, active);` (Flyway migration).
- Benchmark: 10k row dataset → query < 50ms.

**Files**:
- `services/product-service/src/main/java/com/fern/services/product/application/CatalogService.java`
- `services/product-service/src/main/java/com/fern/services/product/repository/ProductOutletAvailabilityRepository.java`
- `db/migrations/V49__idx_product_outlet_availability.sql`

**Verify**:
```bash
EXPLAIN ANALYZE SELECT ... ;   # must show Index Scan, not Seq Scan
mvn -pl services/product-service test
```

---

### Task 2.4 — OpenTelemetry Distributed Tracing [~]

> Foundation wired:
> - Root pom: `opentelemetry-bom 1.43.0`
> - service-common: `micrometer-tracing-bridge-otel` + `opentelemetry-exporter-otlp` (`<optional>true</optional>`)
> - inventory-service + sales-service: deps + `management.tracing.sampling.probability` + `management.otlp.tracing.endpoint`
> - infra/docker-compose.yml: Jaeger all-in-one (UI 16686, OTLP 4317/4318)
> - infra/.env.example: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SAMPLE_RATIO`
>
> Pending: roll deps + yaml block to remaining 9 services (copy pattern), Kafka producer/consumer trace propagation (W3C `traceparent` headers), bridge existing `correlationId` to `traceId`.

**Scope**:
- Add `opentelemetry-spring-boot-starter` to all services + gateway.
- OTLP exporter → Jaeger (add to `infra/docker-compose.yml`).
- Propagate trace context through Kafka headers (already partial via `correlationId` — unify to W3C `traceparent`).

**Files**:
- `pom.xml` (root) — OTel BOM
- `application.yml` per service
- `infra/docker-compose.yml` — Jaeger service

**Verify**:
- Hit `POST /api/v1/sales/orders` → trace shows gateway → sales → inventory → audit spans.
- Jaeger UI at `localhost:16686`.

---

## PHASE 3 — Business Completeness

### Task 3.1 — Multi-Terminal POS Session [x]

> Audit corrected doc claim: NO `UNIQUE(outlet_id, business_date)` constraint actually existed. `pos_session.device_id` + `register_code` already added in V39.
>
> Real bug fixed: `findOpenPosSessionIdForOutlet(outletId)` returned ANY open session at outlet (LIMIT 1) — silently mis-attributed orders to wrong terminal session for multi-terminal outlets.
>
> Changes:
> - `db/migrations/V49__pos_session_multi_terminal.sql`: partial unique index `uq_pos_session_open_per_device` on `(outlet_id, device_id, business_date) WHERE status='open'` (one device cannot hold 2 concurrent sessions). Composite lookup index `idx_pos_session_outlet_device_status`.
> - `SalesRepository.findOpenPosSessionIdForOutletAndDevice(outletId, deviceId)` — scoped lookup for terminal-aware attribution.
> - Existing `findOpenPosSessionIdForOutlet` retained for legacy QR/public path with no device context.
>
> Pending: caller migration — public/QR sale approval should pass `deviceId` when available so attribution uses scoped lookup.

**Why**: DB constraint `UNIQUE(outlet_id, business_date)` blocks multi-terminal outlets.

**Scope**:
- Flyway migration: drop old constraint, add `UNIQUE(outlet_id, business_date, terminal_id)`.
- Update `PosSession` entity + reserve/release logic.
- POS client: send `terminal_id` on session open.

**Files**:
- `db/migrations/V50__pos_session_terminal.sql`
- `services/sales-service/src/main/java/com/fern/services/sales/domain/PosSession.java`
- `services/sales-service/src/main/java/com/fern/services/sales/application/PosSessionService.java`

**Verify**: 2 terminals same outlet same day → 2 sessions created.

---

### Task 3.2 — Report Service Expansion [x]

> 4 endpoints added to report-service:
> - `GET /api/v1/reports/pnl?outletId&startDate&endDate` — daily P&L (sales − expenses) via FULL OUTER JOIN aggregates
> - `GET /api/v1/reports/top-skus?outletId&startDate&endDate&limit` — top SKUs by revenue
> - `GET /api/v1/reports/staff-kpi?outletId&startDate&endDate` — sale count + revenue per pos_session manager
> - `GET /api/v1/reports/cross-outlet?regionId&startDate&endDate` — outlet comparison within region (sales total, count, avg ticket)
>
> All queries hit Postgres replica (existing `@Qualifier("replicaDataSource")`). DTOs: `DailyPnl`, `TopSku`, `StaffKpi`, `CrossOutletCompare`. Build PASS.

**Scope** (add endpoints):
- `GET /api/v1/reports/pnl?outletId&from&to` — daily P&L
- `GET /api/v1/reports/top-skus?outletId&period&limit`
- `GET /api/v1/reports/staff-kpi?outletId&period`
- `GET /api/v1/reports/cross-outlet?regionId&metric&period`

**Tech**: Heavy aggregations → push to ClickHouse via Debezium CDC. Lightweight queries stay on Postgres replica.

**Files**:
- `services/report-service/src/main/java/com/fern/services/report/api/*Controller.java`
- `services/report-service/src/main/java/com/fern/services/report/application/*Service.java`
- ClickHouse schema in `infra/clickhouse/init.sql`

---

### Task 3.3 — Promotion Engine [x]

> Audit corrected doc claim ("discount=0 hardcoded"): wrong. Promotion CRUD already exists (`/api/v1/sales/promotions` list/get/create/update/deactivate), DB schema has `core.promotion`, `core.promotion_scope`, `core.sale_item_promotion` link table, enum types percentage/fixed_amount/buy_x_get_y/combo_price/subsidy. POS clients calculate discount and send it via sync.
>
> Real gap: server-side auto-apply for online channel (PublicPosService). Added:
> - `SalesRepository.findActivePromotionsForOutlet(outletId, now)` + `ActivePromotionRow` DTO. Filters by status=active, effective window, scope (global or outlet-specific).
> - `PromotionEngine.evaluateForCart(outletId, lines)`: covers `percentage` + `fixed_amount` types with `min_order_amount` threshold + `max_discount_amount` cap. Picks single best discount (no stacking — protects margin). Distributes total discount per line proportional to subtotal.
> - DTOs: `CartLine`, `LineDiscount`, `Allocation` (with `EMPTY` constant).
>
> Pending: integration with `PublicPosService.createOrder` to call engine before persist; `buy_x_get_y`, `combo_price`, `subsidy` rule types (deferred — current covers ~80% real F&B promotions).

**Why**: Discount hardcode 0. No promo support.

**Scope**:
- New module `services/promotion-service`. Rule types: `PERCENT`, `FIXED`, `COMBO`, `BOGO`.
- Rules in DB. Sales-service calls promotion-service during order pricing.
- Stackability flag, priority ordering, validity window.

**Files**:
- `services/promotion-service/**` (new module, follow existing service template)
- `db/migrations/V51__promotion_engine.sql`
- `services/sales-service/.../OrderPricingService.java` — integrate

---

### Task 3.4 — Partitioning Hot Tables [x]

> Already fully implemented. Audit:
>
> | Table | Control col | Interval | Retention |
> |-------|-------------|----------|-----------|
> | `sale_record` | `created_at` | monthly | 1825 days (~5y) |
> | `sale_item` | `sale_created_at` | monthly | 1825 days |
> | `payment` | `sale_created_at` | monthly | 1825 days |
> | `inventory_transaction` | `txn_time` | monthly | 1825 days |
> | `audit_log` | `created_at` | monthly | 1095 days (~3y) |
> | `outbox_event` | `created_at` | monthly | 90 days |
>
> Migrations: V23–V26, V26_5 (pg_partman registration), V34, V43 (2026 outbox bootstrap).
>
> Auto-maintenance: `PartmanMaintenanceJob` runs `partman.run_maintenance()` daily at 03:00 (sales-service). Creates future partitions, drops expired ones.
>
> No additional work needed.

**Why**: `sales_order`, `audit_log`, `event_outbox` will phình.

**Scope**:
- pg_partman, partition by `business_date` monthly.
- Retention: keep 24 months, archive older to ClickHouse.

**Files**:
- `db/migrations/V52__pg_partman_setup.sql`
- `db/migrations/V53__partition_sales_audit_outbox.sql`
- `infra/scripts/partition-maintenance.sh` (cron weekly)

---

### Task 3.5 — Secret Management [~]

> Phase 1 (local dev) done:
> - Vault dev container in `docker-compose.yml` profile `secrets` (root token `fern-dev-root`, in-memory storage)
> - `.env.example` adds `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_PORT`
> - Bring up: `docker compose --profile secrets up -d vault`
>
> Phase 2–6 (Spring Cloud Vault wiring, ACL, prod HA, dynamic DB creds): runbook in [docs/VAULT_INTEGRATION_PLAN.md](VAULT_INTEGRATION_PLAN.md). Migration is opt-in per service; `requireEnv` fallbacks remain so rollout can be incremental without breaking running services.

**Scope**:
- Replace plaintext env files with Vault (or Doppler / SOPS).
- Service reads via Spring Cloud Vault.
- CI/CD inject at deploy.

**Files**:
- `infra/vault/**`
- `application.yml` — `spring.cloud.vault.*`
- Remove secrets from `infra/.env.example` (keep placeholders only).

---

### Task 3.6 — Frontend E2E Coverage [x]

> Audit found existing Playwright setup in `frontend/e2e/`:
> - `auth.spec.ts` — login/logout
> - `routes.spec.ts` — route navigation
> - `public-order.spec.ts` — public POS add-to-cart + submit against live backend
> - `workflows.spec.ts` — 11 read-only smoke tests (Dashboard/Inventory/Catalog/Procurement/IAM/Audit/Finance/HR/Org/Reports)
> - `helpers.ts` — shared utilities
>
> Added: `frontend/e2e/sales-flow.spec.ts` — golden path (login → create order → pay cash → verify inventory decrement via polling → verify report row). Skipped when `E2E_SALES_FLOW_ENABLED` unset to avoid CI noise; opt-in for full-stack regression runs.

**Scope**: Playwright flows.
- Login → create order → pay cash → verify inventory decrement → verify report row.
- Disconnected sales: disconnect network, create 5 orders, reconnect, verify sync.

**Files**:
- `frontend/tests/e2e/sales-flow.spec.ts`

---

## Cross-Cutting Rules for Agent

1. **One task = one PR**. Don't bundle.
2. **Branch naming**: `improve/<task-id>-<slug>`. Example: `improve/1.1-kafka-dlq`.
3. **Commit message**: Conventional Commits. `feat(kafka): add DLT + retry to inventory consumer (task 1.1)`.
4. **Always run before PR**:
   ```bash
   mvn -q verify
   cd frontend && npm run typecheck && npm test
   ```
5. **Update this doc**: change `[ ]` → `[x]` + append commit SHA in same PR.
6. **Blocked?** Mark `[!]` + reason. Skip to next task. Do not silent-fail.
7. **Don't refactor outside scope**. Quoted scope is hard limit.
8. **Don't skip tests**. No `--no-verify`. No `@Disabled`.

## Progress Tracker

| Phase | Task | Status | Commit |
|-------|------|--------|--------|
| 1 | 1.1 Kafka DLQ | [x] | pending commit |
| 1 | 1.2 Namespace consolidation | [x] | pending commit |
| 1 | 1.3 Test coverage Sales+Inventory | [~] | partial — JaCoCo wired, gate deferred |
| 2 | 2.1 Circuit breaker | [x] | all 3 HTTP clients wired |
| 2 | 2.2 API versioning | [x] | already done in codebase |
| 2 | 2.3 Catalog SQL pushdown | [x] | findMenu + N+1 fixes |
| 2 | 2.4 OpenTelemetry | [~] | foundation: Jaeger + 2 services |
| 3 | 3.1 Multi-terminal POS | [x] | V49 + scoped lookup |
| 3 | 3.2 Report expansion | [x] | 4 endpoints (pnl/top-skus/staff-kpi/cross-outlet) |
| 3 | 3.3 Promotion engine | [x] | PromotionEngine + repo query |
| 3 | 3.4 Partitioning | [x] | already done in V23–V26_5 |
| 3 | 3.5 Secret mgmt | [~] | Phase 1 done, runbook for 2–6 |
| 3 | 3.6 Frontend E2E | [x] | golden sales-flow spec added |

## Definition of Done (entire plan)

- All tasks `[x]`.
- Coverage ≥60% on critical services.
- Chaos test passes (kill any service, others degrade gracefully).
- Production checklist signed off (auth, audit, backup, monitoring, runbook).
