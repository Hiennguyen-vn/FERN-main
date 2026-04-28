# Follow-up Improvement Plan

> Continuation of [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md). Closes 5 gaps left after first pass + commits hygiene.
> Each item = self-contained PR. Estimated effort + acceptance + verify cmd.

## Snapshot

| Gap | Source task | Effort | Priority |
|-----|-------------|--------|----------|
| F1. Test coverage ≥60% (repo IT layer) | 1.3 | 2 sprints | P1 |
| F2. OTel rollout 9 services | 2.4 | 1 sprint | P2 |
| F3. Vault Phase 2–6 (Spring Cloud Vault wiring → prod HA) | 3.5 | 1 sprint | P2 |
| F4. PromotionEngine integration into PublicPosService | 3.3 | 0.25 sprint | P3 |
| F5. Multi-terminal scoped lookup wire-in | 3.1 | 0.25 sprint | P1 |
| F6. Commit hygiene + PR splits | all | 0.5 sprint | P0 |

Total effort: ~5 sprints. Critical path: F6 → F5 → F1 → F2 → F3 → F4.

---

## F6 — Commit Hygiene + PR Splits [P0, do first]

> Doc rule: one task = one PR. Currently all uncommitted as single working tree.

### Plan

Split current working tree into 14 PRs, in dependency order. Each PR rebased on previous.

| # | Branch | Scope | Files |
|---|--------|-------|-------|
| 1 | `improve/1.1-kafka-dlq` | Task 1.1 | service-common config + 4 consumers |
| 2 | `improve/1.2-namespace-consolidation` | Task 1.2 | 411 files renamed (`com.dorabets`/`com.natsu` → `com.fern.common`) |
| 3 | `improve/1.3-jacoco-baseline` | Task 1.3 partial | root pom JaCoCo + 2 service poms + InventoryServiceTest |
| 4 | `improve/test-infra-A` | TestPlan A | `common/test-support` module + integration-tests profile + JaCoCo aggregate |
| 5 | `improve/test-infra-B-inventory` | TestPlan B | InventoryRepositoryIT + jacoco:check rule |
| 6 | `improve/test-infra-C-sales-wiring` | TestPlan C | sales pom test-support dep + classifier |
| 7 | `improve/2.1-circuit-breaker` | Task 2.1 | resilience4j on payroll/finance/master-node |
| 8 | `improve/2.3-catalog-sql-pushdown` | Task 2.3 | MenuRepository findMenu + N+1 fix |
| 9 | `improve/2.4-otel-foundation` | Task 2.4 partial | OTel deps + Jaeger compose + 2 service yaml |
| 10 | `improve/3.1-multi-terminal-pos` | Task 3.1 | V49 migration + scoped lookup |
| 11 | `improve/3.2-report-expansion` | Task 3.2 | 4 new endpoints |
| 12 | `improve/3.3-promotion-engine` | Task 3.3 | PromotionEngine + repo query |
| 13 | `improve/3.5-vault-phase1` | Task 3.5 | Vault container + plan doc |
| 14 | `improve/3.6-e2e-sales-flow` | Task 3.6 | sales-flow.spec.ts |

### Steps (per PR)

```bash
git checkout main
git checkout -b improve/<id>-<slug>
git add <scope-files>
git commit -m "<conventional>: <one-line> (task <id>)

<body explaining why + summary>

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
gh pr create --title "..." --body "<from improve plan>"
```

### Verify

```bash
git log --oneline main..HEAD | wc -l   # = 14 commits across branches
gh pr list --author @me --label improvement | wc -l   # = 14 PRs
```

---

## F5 — Multi-Terminal Lookup Wire-In [P1, 0.25 sprint]

> Doc 3.1 done at infra layer. Caller side still uses non-scoped lookup.

### Scope

`SalesRepository.approveSale()` line 851 currently calls `findOpenPosSessionIdForOutlet(conn, lockedSale.outletId())`. Replace with device-scoped variant when `RequestUserContext.deviceId()` available.

### Files

- `services/sales-service/src/main/java/com/fern/services/sales/infrastructure/SalesRepository.java`
  - Modify `approveSale` to read `RequestUserContextHolder.get().deviceId()`, branch:
    - if non-null → `findOpenPosSessionIdForOutletAndDeviceTx(conn, outletId, deviceId)`
    - else → existing `findOpenPosSessionIdForOutlet(conn, outletId)` (legacy QR/public path)
- `services/sales-service/src/test/java/.../SalesServiceTest.java` — 2 new tests:
  - device context present → picks scoped session
  - device context absent → falls back to outlet-wide session

### Acceptance

- Approval with device context X attributes order to session opened by X.
- Approval without device context falls back to most-recent open session (current behavior).
- 2 unit tests pass.

### Verify

```bash
mvn -pl services/sales-service test -Dtest=SalesServiceTest
```

---

## F4 — PromotionEngine Integration [P3, 0.25 sprint]

> Engine ready, not yet called.

### Scope

Wire `PromotionEngine.evaluateForCart()` into `PublicPosService.createOrder()` before calling `salesRepository.submitPublicOrder()`.

### Files

- `services/sales-service/src/main/java/com/fern/services/sales/application/PublicPosService.java`
  - Inject `PromotionEngine`.
  - Before `submitPublicOrder`, build `List<CartLine>` from `request.items()`, call `engine.evaluateForCart(table.outletId(), lines)`.
  - Propagate `Allocation.lineDiscounts` into the request items as `discountAmount`.
- `services/sales-service/src/test/java/.../PublicPosServiceTest.java` — extend with:
  - active 10% promo → 10% discount on cart total
  - cart below `min_order_amount` → no discount
  - no active promos → unchanged total

### Acceptance

- Online order with active percentage promo gets discount auto-applied.
- Discount stored in `sale_item.discount_amount`.
- Promotion `id` linked via `sale_item_promotion` (extend repo if needed).

### Verify

```bash
mvn -pl services/sales-service test -Dtest=PublicPosServiceTest
# Then manual: create promo, post public order, check sale_item.discount_amount
```

---

## F1 — Test Coverage to ≥60% [P1, 2 sprints]

> Foundation done (Testcontainers + JaCoCo aggregate). Need to write IT tests until repos hit 60%.

### Sprint 1: Inventory ≥60%

Target: 16.8% → 60% line coverage on `inventory-service`. Need ~480 more lines covered.

#### IT tests to add

| Test class | Methods | Lines covered |
|------------|---------|---------------|
| `InventoryRepositoryIT` (extend) | listStockBalances paging/sort/filter, listTransactions, applyStockDelta concurrency, applySaleApproved (recipe explosion), applySaleCancelled (reversal), applyGoodsReceiptPosted, applyOfflineStockIn idempotent, stock count session lifecycle, low-stock detection | ~500 |
| `InventoryEventConsumerIT` (new) | full Kafka roundtrip via KafkaContainerExtension: SaleApprovedEvent → balance updated, malformed event → DLT, duplicate event → skipped | ~80 |

#### Steps

1. Extend `InventoryRepositoryIT` with each test method (~10 tests, 1 day each).
2. Create `InventoryEventConsumerIT` using `KafkaContainerExtension`.
3. After each test, re-run `mvn -pl services/inventory-service -Pintegration-tests verify`, verify coverage incrementing in `target/site/jacoco-merged/`.
4. When ≥60% reached, raise `jacoco:check` floor from 0.15 → 0.60.

### Sprint 2: Sales ≥60%

Target: 10.7% → 60% line coverage on `sales-service`. Need ~1700 more lines covered.

#### IT tests to add

Split `SalesRepositoryIT` into 5 files:
- `SalesRepositoryOrderIT` — order CRUD, status transitions
- `SalesRepositoryPaymentIT` — payment allocation, multi-payment, change calc, `check_supplier_payment_allocations`
- `SalesRepositorySessionIT` — POS session open/close, business date rollover, multi-terminal scoped lookup (verify F5)
- `SalesRepositorySyncIT` — offline sync upsert, dedupe via `source_event_id`, advisory locking
- `SalesRepositoryRefundIT` — refund flow, original payment lookup

Plus:
- `SyncServiceIT` (Kafka roundtrip)
- `SalesController` slice tests with `@WebMvcTest`

### Acceptance

- `mvn -Pintegration-tests verify` runs to completion both modules.
- `target/site/jacoco-merged/jacoco.csv` shows ≥60% line on each.
- `jacoco:check` rule raised to 0.60, build fails if dropped below.

### Verify

```bash
mvn -pl services/inventory-service,services/sales-service -Pintegration-tests verify
awk -F, 'NR>1{m+=$8;c+=$9}END{printf "%.1f%%\n",100*c/(m+c)}' \
  services/inventory-service/target/site/jacoco-merged/jacoco.csv
# must be ≥ 60.0%
```

---

## F2 — OTel Rollout 9 Services [P2, 1 sprint]

> Foundation in inventory + sales. Same pattern needed in 9 others + Kafka context propagation.

### Services to wire

auth-service, org-service, hr-service, product-service, procurement-service, payroll-service, finance-service, audit-service, report-service, master-node, gateway

### Per-service changes

1. `pom.xml`:
   ```xml
   <dependency><groupId>io.micrometer</groupId><artifactId>micrometer-tracing-bridge-otel</artifactId></dependency>
   <dependency><groupId>io.opentelemetry</groupId><artifactId>opentelemetry-exporter-otlp</artifactId></dependency>
   ```
2. `application.yml` under `management:`:
   ```yaml
   tracing:
     sampling:
       probability: ${OTEL_SAMPLE_RATIO:1.0}
   otlp:
     tracing:
       endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4318/v1/traces}
   ```
3. Service name: relies on `spring.application.name` (already set everywhere).

### Cross-cutting

- Kafka header propagation: Spring Kafka 3.x auto-instruments when `micrometer-tracing` + `opentelemetry` on classpath. No code change.
- Bridge legacy `correlationId` (existing audit infra) → OTel `traceId`: add filter that reads incoming `X-Correlation-Id` header, stores in baggage, mirrors trace ID into outgoing audit logs. New file `common/service-common/src/main/java/com/fern/common/spring/web/CorrelationIdToTraceFilter.java`.
- Gateway: configure Spring Cloud Gateway to forward `traceparent` + `tracestate` headers (it does by default, but verify with end-to-end trace test).

### Verify

```bash
docker compose up -d jaeger
# Make request: gateway → sales → inventory → audit
curl -X POST http://localhost:8080/api/v1/sales/orders -H 'Authorization: Bearer ...' -d '{...}'
# Check Jaeger UI: localhost:16686 → service "fern-gateway" → trace shows 4 spans
```

---

## F3 — Vault Phase 2–6 [P2, 1 sprint]

Runbook in [VAULT_INTEGRATION_PLAN.md](VAULT_INTEGRATION_PLAN.md). Sprint breakdown:

### Week 1: Phase 2 — Spring Cloud Vault wiring (dev)

- Add `spring-cloud-starter-vault-config` to service-common (optional).
- Each service `application.yml` adds `spring.config.import: optional:vault://`.
- Migrate JWT_SECRET first: replace `requireEnv("JWT_SECRET")` with `@Value("${jwt.secret}")` reading from Vault context `fern/shared/jwt`.
- Verify with dev Vault container.

### Week 1: Phase 3 — Seed script

- Commit `infra/scripts/vault-seed-dev.sh` (writes JWT/internal/postgres/s3 keys to dev Vault).
- Update `start.sh` to invoke seed when `--secrets` flag given.

### Week 2: Phase 4 — AppRole + ACL

- Per-service policy files in `infra/vault/policies/`.
- AppRole auth backend enabled via `vault auth enable approle`.
- CI workflow generates RoleID/SecretID at deploy, injects as env.

### Week 2: Phase 5 — Prod cluster (infrastructure-as-code only)

- Terraform module `infra/terraform/vault/` — 3-node Raft cluster, KMS unseal, audit-to-S3.
- Document handoff to platform team for actual cloud deploy.

### Phase 6 (Sprint+1): Dynamic Postgres credentials

- Vault Postgres database engine config.
- Service rotates short-lived (1h) Postgres roles.
- Spring Cloud Vault auto-renew lease.

### Acceptance

- Local dev: `docker compose --profile secrets up vault` + seed → all services start using Vault-backed secrets.
- Toggle `spring.cloud.vault.enabled=false` → fallback to env vars works.
- Audit log shows secret access trail.

### Verify

```bash
docker compose --profile secrets up -d vault
./infra/scripts/vault-seed-dev.sh
docker compose up -d auth-service
curl localhost:8081/actuator/health | jq '.components.vault.status'   # UP
docker compose logs auth-service | grep -i 'jwt secret'   # no plaintext
```

---

## Cross-cutting acceptance for entire follow-up

- All 14 PRs from F6 merged.
- F1: coverage 60% gate passes in CI.
- F2: end-to-end trace visible in Jaeger across all services.
- F3: prod deploy reads secrets from Vault, no plaintext in env.
- F4: online order with active promo gets auto-discount.
- F5: multi-terminal outlet attributes order to correct session.

## Risk & mitigation

| Risk | Mitigation |
|------|-----------|
| F1 IT tests flaky due to container reuse | `withReuse(true)` + `Ryuk disabled` in CI; reset DB schema between classes via `flyway.clean()` |
| F2 OTel adds latency overhead | Sampling ratio configurable per service; default 1.0 in dev, 0.1 in prod |
| F3 Vault outage = total cluster down | Token cache + fallback env vars; Vault HA cluster separate from app cluster |
| F4 promotion mis-applied = revenue loss | Gate behind feature flag `promotion.engine.enabled`, default `false` until tested |
| F5 wrong session attribution = audit/report wrong | Migrate calls one-by-one; existing `findOpenPosSessionIdForOutlet` retained as fallback |
| F6 PR splits introduce conflicts on rebase | Land in dependency order; use `git rerere` to remember conflict resolutions |

## Definition of Done

- [ ] F6: 14 PRs all merged into main
- [ ] F5: scoped session lookup wired in `approveSale`, 2 tests pass
- [ ] F1: inventory + sales line coverage ≥60% on `mvn -Pintegration-tests verify`, jacoco:check rule at 0.60
- [ ] F2: Jaeger UI shows full trace from gateway → all 11 services
- [ ] F3: dev Vault seeded + all services read from Vault, prod cluster terraform reviewed
- [ ] F4: PublicPosService applies promo discount automatically
- [ ] All builds green, no `--no-verify`, no `@Disabled`
