# Test Coverage Closure Plan

> Follow-up for Task 1.3 of IMPROVEMENT_PLAN.md. Goal: hit ≥60% line coverage on `sales-service` and `inventory-service`, enforced in CI. Approach: layer-by-layer with Testcontainers Postgres + Kafka.

## Implementation Progress

| Phase | Status | Notes |
|-------|--------|-------|
| A1 test-support module | [x] | `common/test-support` module live: `PostgresContainerExtension`, `KafkaContainerExtension`, `TestUserContext`, `TestFixtures` |
| A2 integration-tests profile | [x] | Failsafe plugin + `-Pintegration-tests` toggle; `*IT.java` excluded from surefire |
| A3 JaCoCo aggregate | [x] | `prepare-agent-integration` + `merge` → `jacoco-merged.exec` |
| B Inventory IT | [~] | 3 IT tests landed (`InventoryRepositoryIT`); foundation proven, more tests pending |
| C Sales IT | [~] | Pom wired (test-support dep, failsafe, exec classifier); IT tests not yet written |
| D CI gate | [x] | `jacoco:check` rule per module on merged exec — current floor: inventory 15%, sales 10% (ratchet target) |
| E mutation testing | [ ] | Deferred until 60% reached |

**Gate currently low (10–15%) intentionally**: ratchet up monthly as IT tests added. Hard 60% gate flips on once Phase B+C complete.

## Build commands

| Goal | Command |
|------|---------|
| Unit tests only (fast) | `mvn test` |
| Unit + integration | `mvn -Pintegration-tests verify` |
| Coverage gate check | `mvn -Pintegration-tests verify` (jacoco:check binds to `verify`) |
| Coverage HTML report | `services/<svc>/target/site/jacoco/` (unit), `jacoco-it/` (IT), `jacoco-merged/` (merged via re-run report) |

## Current State (baseline 2026-04-28)

| Module | Line cov | Branch cov | Classes |
|--------|----------|------------|---------|
| sales-service | 10.7% (368/3448) | 10.6% | 94 |
| inventory-service | 16.8% (191/1138) | 9.0% | 27 |

Repository layer = ~80% of LOC, ~0% covered. Cannot mock — needs real DB.

## Strategy

**Three-layer test pyramid**:

```
        ┌─────────────────┐
        │  E2E (Playwright)│   ← Task 3.6
        ├─────────────────┤
        │  Integration    │   ← THIS PLAN (Testcontainers)
        │  (Postgres+Kafka)│
        ├─────────────────┤
        │  Unit (mock)    │   ← Task 1.3 partial done
        └─────────────────┘
```

Unit tests cover application/business logic with mocks. Integration tests cover repositories, transaction boundaries, Kafka outbox, idempotency, real SQL behavior. Skip mocking the DB layer — that's where most bugs hide.

## Phase A — Test Infrastructure (1 sprint)

### A1. Shared test-support module

Create `common/test-support` module. Provides:

- `@PostgresTestContainer` — JUnit 5 extension, spins Postgres 16 once per JVM, runs Flyway migrations, returns `DataSource`.
- `@KafkaTestContainer` — embedded Kafka via Testcontainers `KafkaContainer`.
- `@RedisTestContainer` — for idempotency L1 tests.
- `TestUserContext` — helper to build `RequestUserContext` + push into holder.
- `TestEventPublisher` — capture-only `TypedKafkaEventPublisher`.

Layout:
```
common/test-support/
  src/main/java/com/fern/common/test/
    PostgresContainerExtension.java
    KafkaContainerExtension.java
    TestUserContext.java
    TestFixtures.java   ← seed standard outlets/users/items
```

Dep: scope `test` only when consumed. The module itself ships as `jar` with `<scope>test</scope>` declared by consumers.

**Tech**:
- Testcontainers 1.20.x
- Postgres 16 image (matches prod)
- Reuse single container across test classes via `@Container static`
- Flyway runs once on first connection

### A2. Surefire profile

Add `<profile>integration-tests</profile>` in root pom. Default `mvn test` runs unit tests only (fast). `mvn -Pintegration-tests verify` runs both. CI pipeline runs both.

Fork mode: `<forkCount>1</forkCount> <reuseForks>true</reuseForks>` so containers reused.

### A3. JaCoCo aggregate

Add `jacoco:report-aggregate` at root. Combines unit + integration `.exec` files. CI threshold check on aggregate.

Threshold: start at 30%, raise quarterly until 60%.

## Phase B — Inventory Service Tests (1 sprint)

### B1. InventoryRepository integration tests

File: `services/inventory-service/src/test/java/com/fern/services/inventory/infrastructure/InventoryRepositoryIT.java`

Critical paths:

- [ ] `findStockBalance` — exists / not exists / different outlet
- [ ] `listStockBalances` — paging, lowOnly filter, search query, sort
- [ ] `applyStockDelta` trigger correctness — concurrent decrement maintains consistency
- [ ] `createWaste` — creates txn + decrements balance atomically
- [ ] `applySaleApprovedMovements` — recipe explosion, multi-component
- [ ] `applySaleCancelledMovements` — reversal generates positive txn
- [ ] `applyGoodsReceiptPosted` — increment + cost update
- [ ] `applyOfflineStockIn` — idempotent on `source_event_id`
- [ ] Stock count session: create → add lines → post (variance generates adjustment txn)
- [ ] Low-stock threshold detection

Target: cover 600+ of 760 lines = ~80% on this class alone.

### B2. InventoryEventConsumer integration tests

File: `InventoryEventConsumerIT.java` — full Kafka roundtrip.

- [ ] Publish `SaleApprovedEvent` → consumer commits → balance updated
- [ ] Duplicate event → idempotency guard skips
- [ ] Malformed JSON → 3 retries → DLT topic
- [ ] DLT handler logs + counter increments

### B3. InventoryService unit tests (expand)

Existing: 7 tests. Add:
- [ ] `listStockBalances` paging edge cases (limit clamp, offset negative)
- [ ] `createStockCountSession` — auth, idempotency
- [ ] `postStockCountSession` — variance calculation, low-stock event publishing
- [ ] `applySaleApproved` — recipe missing → no movement
- [ ] `applySaleCancelled` — partial cancellation
- [ ] `applyOfflineStockIn` — clock skew, business date validation

Target: 90% on `InventoryService` (currently ~40%).

**Inventory module target**: ≥60% line, ≥50% branch.

## Phase C — Sales Service Tests (2 sprints)

### C1. SalesRepository integration tests (largest gap)

File: `SalesRepositoryIT.java`. 2k LOC, ~50+ methods. Split into:

- `SalesRepositoryOrderIT` — order CRUD, status transitions
- `SalesRepositoryPaymentIT` — payment allocation, multi-payment, change calc
- `SalesRepositorySessionIT` — POS session open/close, business date rollover
- `SalesRepositorySyncIT` — offline sync upsert, dedupe via `source_event_id`
- `SalesRepositoryRefundIT` — refund flow, original payment lookup

Critical SQL behavior:
- [ ] `check_supplier_payment_allocations` constraint (sum payments ≤ total)
- [ ] Unique `(outlet_id, business_date)` POS session — should fail on duplicate (will change in Task 3.1)
- [ ] Concurrent payment capture — one wins, other gets conflict
- [ ] Outbox row written in same TX as order insert
- [ ] Order status state machine enforced at DB level

Target: 50% on `SalesRepository` = ~1000 lines. Hard ceiling without exhaustive query branching.

### C2. SyncService integration tests

File: `SyncServiceIT.java`. Currently 2% covered, 410 lines.

- [ ] Push 10 events → all persisted, outbox populated, response per event
- [ ] Mixed retry-classification: validation reject vs dependency failure vs duplicate
- [ ] Clock skew clamping (already partial unit-tested)
- [ ] Device scope enforcement — wrong outlet rejected
- [ ] Replay scenario: same batch twice → idempotent
- [ ] Backpressure: 1000 events → batched correctly

### C3. SalesService unit tests (expand)

Already 55%. Push to 80%:
- [ ] CRM lookup integration
- [ ] Promotion application (placeholder, real engine in Task 3.3)
- [ ] Refund authorization edge cases
- [ ] Multi-currency edge case
- [ ] Tax calculation rounding

### C4. PaymentStateMachine — already 100% (24 tests). No work.

### C5. Controllers (zero coverage now)

`SalesController`, `SyncController`, `DeviceController` — slice tests with `@WebMvcTest`:
- [ ] Auth filter integration
- [ ] DTO validation (Bean Validation)
- [ ] Error mapping (`ServiceException` → HTTP code)

Each controller ~50 LOC, 5 tests apiece.

### C6. PosMetrics, SearchIndexer

`PosMetrics` 131 LOC = Micrometer counters. Test:
- [ ] Counter increments on each event type
- [ ] Tags include outlet/terminal correctly

`SearchIndexer` 46 LOC = OpenSearch client wrapper. Mock client:
- [ ] Index document on order completed
- [ ] Bulk batching threshold

**Sales module target**: ≥60% line, ≥45% branch.

## Phase D — CI Enforcement (½ sprint)

### D1. Threshold ratchet

`pom.xml` jacoco-maven-plugin `check` execution:

```xml
<execution>
  <id>jacoco-check</id>
  <goals><goal>check</goal></goals>
  <configuration>
    <rules>
      <rule>
        <element>BUNDLE</element>
        <limits>
          <limit>
            <counter>LINE</counter>
            <value>COVEREDRATIO</value>
            <minimum>0.60</minimum>
          </limit>
          <limit>
            <counter>BRANCH</counter>
            <value>COVEREDRATIO</value>
            <minimum>0.45</minimum>
          </limit>
        </limits>
      </rule>
    </rules>
  </configuration>
</execution>
```

Apply per-module starting at module's current achievable level. Ratchet up monthly.

### D2. CI pipeline (GitHub Actions)

`.github/workflows/test.yml`:
```yaml
- run: mvn -B verify -Pintegration-tests
- uses: codecov/codecov-action@v4
  with:
    files: ./services/*/target/site/jacoco/jacoco.xml
- name: Coverage gate
  run: mvn jacoco:check
```

PR must pass coverage gate. Fail-fast.

### D3. Coverage badge

README badge from Codecov for visibility.

## Phase E — Mutation Testing (½ sprint, optional)

After 60% line coverage hit. PIT plugin (`pitest-maven`). Catches "tests exist but assert nothing" rot. Target ≥40% mutation score on critical packages.

Run weekly cron, not per-PR (slow).

## Effort Estimate

| Phase | Sprints | Output |
|-------|---------|--------|
| A. Test infra | 1 | `test-support` module, Testcontainers, profiles |
| B. Inventory tests | 1 | Inventory ≥60% |
| C. Sales tests | 2 | Sales ≥60% |
| D. CI enforcement | 0.5 | Threshold gate live |
| E. Mutation (optional) | 0.5 | Mutation score signal |
| **Total** | **5** | 60% gate enforced |

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| Testcontainer slow → CI times out | Reuse containers via `@Container static` + `withReuse(true)` + Ryuk disabled in CI |
| Flaky SQL ordering in tests | Always order by deterministic key, never by insertion order |
| Test DB schema drift | Same Flyway migrations as prod — single source of truth |
| Kafka container memory hog | One shared `KafkaContainer` per JVM, not per class |
| Coverage gaming (assertion-free tests) | Phase E mutation testing catches it |
| New PRs drop coverage | `jacoco:check` in `verify` blocks merge |

## Definition of Done

- [ ] `common/test-support` module published.
- [ ] `mvn -Pintegration-tests verify` runs Postgres + Kafka containers.
- [ ] Inventory line coverage ≥60% in CSV.
- [ ] Sales line coverage ≥60% in CSV.
- [ ] `mvn jacoco:check` fails build below threshold.
- [ ] CI pipeline enforces gate on PRs.
- [ ] Coverage badges on README.
- [ ] Critical flows have integration tests:
  - [ ] Order create → inventory decrement → audit log → report row
  - [ ] Offline sync push → idempotent replay → consistent state
  - [ ] Payment capture → invoice issuance → expense record
  - [ ] Goods receipt → stock increase → cost update

## Cross-Cutting Test Quality Rules

1. **No mocking the DB**. Use Testcontainers.
2. **No `@Disabled`**. If broken, fix or delete.
3. **Each test asserts at least one outcome**. No "smoke tests" without assertions.
4. **Test names describe behavior**, not method names. `paymentRejectedWhenAmountExceedsTotal` not `testCapturePayment`.
5. **One assertion concept per test**. Multiple `assertEquals` OK if they verify same invariant.
6. **No shared mutable state across tests**. Reset DB per test or use distinct keys.
7. **Test data via fixtures**, not inline magic constants.
8. **Time = injected `Clock`**. Never `Instant.now()` in tests.
