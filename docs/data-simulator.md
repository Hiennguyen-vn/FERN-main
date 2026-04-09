# Internal Data Simulator

## Purpose

The internal data simulator is a small Spring Boot web app that generates realistic operational data directly into the local FERN database in business-correct chronological order.

It is designed for:

- local development
- workflow demos
- test data expansion
- repeatable seeded scenarios with deterministic randomness

It is **not** a public product surface and is **not** exposed through the gateway.

## Day-by-Day Simulation Engine

The simulator runs through a **day-by-day `SimulationEngine`** that iterates from `startDate` to `endDate` one calendar day at a time. On each day, six phases execute in order:

1. **Expansion** — opens new regions, subregions, and outlets on a pre-computed schedule; creates suppliers, items, products, recipes, prices, and exchange rates when the first outlet opens
2. **Workforce** — hires founding staff for newly opened outlets; applies monthly turnover (terminations and replacements) after the first month
3. **Procurement** — processes pending deliveries (goods receipts from earlier POs); creates new purchase orders when any item's stock falls below its minimum level
4. **Sales** — generates daily sales orders with demand shaped by day-of-week multipliers and outlet maturity ramp; stock-safe (skips when inventory is insufficient)
5. **Payroll** — generates monthly payroll periods, timesheets, and payroll records on the 1st of each month for the prior period
6. **Inventory** — optional daily waste records and periodic stock count sessions

Each day produces a `DaySummary` capturing outlets opened, employees hired/suspended, sales created, procurement events, payroll runs, and warnings. These are aggregated into `MonthSummary` records that form the execution timeline.

All data writes happen through `inventory_transaction` (never `stock_balance` directly), use `SnowflakeIdGenerator` for all primary keys, and respect the database schema constraints.

## Architecture

The simulator lives at `tools/data-simulator-app`.

Key classes:

- `SimulationEngine` — day-by-day driver
- `PhaseHandler` implementations in `engine/phases/`
- `SimulationContext` — mutable shared state for the run
- `SimulatorRepository.executeViaEngine()` — wraps the engine call in a JDBC transaction
- `SimulationExecutionService` — orchestrates preview validation, safety checks, and engine execution
- `ExecutionProgressTracker` — tracks in-memory progress with database persistence
- `SimulatorRunRepository` — persists run metadata to `core.simulator_run`

## Safety Model

The simulator is intentionally defensive:

- binds to `127.0.0.1` by default
- does not go through the public gateway
- execution is disabled by default
- write runs require preview first, then explicit confirmation
- execution is blocked unless the configured JDBC target looks local/safe
- obvious production host fragments are blocked by default

Key environment flags:

- `SIMULATOR_EXECUTION_ENABLED=false` — default; preview-only mode
- `SIMULATOR_EXECUTION_ENABLED=true` — allows write runs after preview and confirmation
- `SIMULATOR_ALLOW_NON_LOCAL=false` — default; only localhost-like DB hosts are accepted

## How To Run

Start local infra and migrate the database first:

```sh
cd /Users/nguyendinhkhiem/Development/Javas/FERN
cp infra/.env.example infra/.env
./infra/scripts/start.sh
./db/scripts/migrate.sh
```

Run the simulator in preview-only mode:

```sh
./infra/scripts/start-data-simulator.sh
```

By default, the built-in simulator config does not create any outlets. To generate outlets and operational data, provide a custom config or preset override that sets `expansion.initialOutlets > 0` and enables expansion explicitly.

Run with writes enabled:

```sh
./infra/scripts/start-data-simulator.sh --execute
```

Open `http://127.0.0.1:8094`.

## Preview vs Execute

The simulator workflow is intentionally three-step:

1. **Preview** — validates configuration, checks namespace collision, estimates row counts, exports scenario as JSON, reports safety blockers and warnings
2. **Confirm** — a modal dialog shows the namespace, database target, and estimated row count; the operator must explicitly confirm
3. **Execute** — runs the day-by-day engine in a virtual thread; the UI polls for progress and renders results in-page without reload

## Progress Visibility

During execution, the progress overlay shows:

- a percentage bar based on completed days / total days
- the current simulation date (e.g., "Day 342 / 9,497 — 2000-11-08")
- live counts from the latest day: outlets, employees, sales, procurement, payroll
- completed month summaries with activity breakdowns (outlets opened, hired, sales, POs)
- elapsed time counter

The server exposes:

- `POST /execute/async` — starts execution, returns `{ execToken, totalDays }`
- `GET /execute/progress/{token}` — returns `ExecutionProgress` with day-by-day detail

The frontend polls at ~700ms intervals.

## Run Persistence

Run metadata is persisted in `core.simulator_run`:

- On start: status `running`, scenario JSON, total days
- During execution: `completed_days` updated every ~30 days
- On completion: status `complete`, result JSON (row counts, validations, highlights, month summaries, `credentialCount`, and a **bounded** side-effect journal sample: `sideEffectJournalTotal` plus up to 200 `sideEffectJournalSample` entries)
- On failure: status `error`, error message
- On app restart: any `running` runs are marked `interrupted`

Endpoints:

- `GET /runs` — recent runs; optional `status` and `namespace` query filters; each row includes `credentialsAvailable` (true only while that run’s passwords still live in the app JVM)
- `GET /runs/{id}` — same shape as list items (flat JSON), including `cleanedAt` and `cleanupSummaryJson` when a run was cleaned

Columns on `core.simulator_run` (after Flyway V10): `cleaned_at`, `cleanup_summary_json` — populated when cleanup completes (audit of deleted row counts; no secrets).

## Post-Run Summary

After execution, the UI shows:

- run ID, namespace, start/end timestamps
- rows created by entity/table
- invariant checks (stock validation, employee counts, payroll counts)
- **Platform-style event journal** (logical event types named like `common/event-schemas` topics, e.g. `sales.sale.completed`) — describes DB artifacts the real stack would usually pair with async messaging; **the simulator does not publish to Kafka** and does not write `core.audit_log`
- a month-by-month timeline with collapsible detail per month
- notable days within each month (outlets opened, employees hired, sales counts)

### Three layers of fidelity

1. **Real DB rows** — JDBC inserts into `core.*` tables (the simulator is a direct writer).
2. **Event journal** — append-only in-memory list on the run; “what consumers might have seen” by name only; **not emitted**.
3. **Not modeled** — full finance ledger beyond expense artifacts, `audit_log`, cross-service consumers, and any behavior that depends on live Kafka.

## Test Coverage

### Java unit and integration tests

- preset/default handling tests
- safety target tests
- preview validation and determinism tests
- controller tests for preview/execute flow
- **H2:** day-by-day engine smoke tests (schema approximation; fast feedback — **not** authoritative for PG cleanup mechanism or trigger semantics)
- timeline coherence test: 3-month scenario verifying chronological correctness
- large-scenario test (opt-in): 5-year multi-outlet scenario

Run the module tests:

```sh
mvn -pl tools/data-simulator-app -am test
```

Run the large-scenario H2 test (longer timeout expected):

```sh
mvn -pl tools/data-simulator-app test -Dsimulator.large.test=true -Dtest=SimulationExecutionIntegrationTest
```

### PostgreSQL integration tests (high-fidelity)

Testcontainers-based tests run the engine against a real PostgreSQL 16 instance with the full Flyway schema through **V10** (triggers, constraints, enum types, cleanup stock-sync guard). These catch column mismatches and enum value errors that H2 cannot detect. Additional PG-only cases include cleanup preview vs execute totals, persisted `cleanup_summary_json` with `cleanupMechanism` (`TRIGGER_GUARD` on default superuser), in-memory credential availability on `ExecutionProgressTracker`, non-superuser cleanup as `fern_app` (still `TRIGGER_GUARD`), and assertions that the side-effect journal is populated on real runs.

Run (requires Docker):

```sh
mvn -pl tools/data-simulator-app test -Dsimulator.pg.test=true -Dtest=PostgresIntegrationTest
```

Run the PG-backed large-scenario test (2-year simulation on real PG):

```sh
mvn -pl tools/data-simulator-app test -Dsimulator.pg.test=true -Dsimulator.large.test=true -Dtest=PostgresIntegrationTest
```

### Playwright browser tests

The e2e suite under `tools/data-simulator-app/e2e/` covers:

- page load smoke, default dates, form sections
- users modal open/close and form state preservation
- preview flow
- SQL check and clear database AJAX with form state preservation
- execute confirmation dialog
- live estimates, distribution normalization, preset changes

Run (requires simulator running on port 8094):

```sh
cd tools/data-simulator-app/e2e
npm install && npx playwright install chromium
npx playwright test
```

Opt-in execute-flow test (requires `SIMULATOR_EXECUTION_ENABLED=true` and a clean DB):

```sh
PLAYWRIGHT_LIVE_DB=1 npx playwright test
```

## Per-Run Cleanup

The simulator supports safe per-namespace cleanup. This removes all data generated by a specific simulator run without affecting other runs, manually created data, or shared reference data.

### Namespace ownership

Root identification uses `code` (or `employee_code` / `supplier_code`) **starting with** the run namespace prefix on:

- outlets, regions, items, products, suppliers, users (via `employee_code`), and namespace-prefixed item/product categories

### Delete behavior

- Deletes transactional data in FK-safe order (expenses, payroll, inventory, procurement, sales, catalog, workforce, then root entities)
- **PostgreSQL (recommended):** Flyway `V10__simulator_cleanup_stock_sync_guard.sql` extends `core.sync_stock_balance` so that when the cleanup transaction runs `SET LOCAL fern.simulator_cleanup = 'on'`, inventory deletes do not resync `stock_balance` (avoiding negative-stock trigger failures). This works with a normal DB user and does **not** require `session_replication_role`.
- **Fallback:** If the GUC cannot be set (H2, or PostgreSQL before V10), the service attempts `SET session_replication_role = 'replica'` (superuser-only on PostgreSQL). Without either mechanism, cleanup may fail on real PG with stock triggers enabled.
- **Never deleted:** shared reference data (currencies, UOMs, roles, permissions)

### Cleanup preview probes

`POST /cleanup/preview` runs short read-only transactions that **roll back** to probe whether `SET LOCAL fern.simulator_cleanup` and (separately) `session_replication_role` would succeed. The response includes `expectedMechanism`, probe booleans, and human-readable `mechanismNotes` so operators know the canonical path vs compat before deleting data.

### Persistence after cleanup

- Matching `core.simulator_run` rows: `status = 'cleaned'`, `cleaned_at`, `cleanup_summary_json` (JSON with `deletedCounts`, `totalDeleted`, `preservedNote`, `cleanupMechanism`, optional `cleanupWarnings` — no passwords)

Preview before cleanup: `POST /cleanup/preview?namespace=...` returns row counts per table without deleting.

Execute cleanup: `POST /cleanup/execute?namespace=...` performs the deletion in a single transaction.

The UI provides cleanup from run detail for `complete` / `error` / `interrupted` runs, with a confirmation modal showing the preview counts; cleaned runs show when cleanup ran and the persisted summary.

## Credential Lifecycle

Generated credentials are intentionally **ephemeral**:
- Available in the UI immediately after a run completes (both sync and async paths)
- Exportable as CSV via a one-time download button; the UI can warn on browser unload until you export (tracked per run id in `sessionStorage`)
- Accessible via `GET /runs/{id}/credentials` only while the run is still in memory
- `GET /runs` / `GET /runs/{id}` expose `credentialsAvailable` so you can see which runs still have passwords in the JVM vs which only have `credentialCount` in persisted `result_json`
- Returns 410 Gone after app restart or session eviction
- Never stored in `core.simulator_run.result_json` or any persistent store (only `credentialCount`)

The UI explains that passwords are not written to the database and are lost on app restart.

## Run History

Recent runs are visible in the sidebar and loaded via `GET /runs?limit=…` with optional `status` and `namespace` filters. Each row shows:
- Namespace and status badge (complete, error, interrupted, running, cleaned)
- Completed day count vs total days
- Hint when `credentialsAvailable` is true (passwords still in this app session)
- Expandable detail: credential guidance, row counts, validations, month summaries; for **cleaned** runs, `cleanedAt` and per-table deleted counts from `cleanup_summary_json`
- Cleanup button for `complete` / `error` / `interrupted` runs (not for already cleaned runs)

Run data that persists across restart: status, namespace, scenario config, timestamps, completed days, row counts, validations, highlights, month summaries, cleanup audit fields after cleanup.

## Simulation Fidelity

### What IS simulated
- Full day-by-day chronological business flow: expansion, workforce, procurement, sales, payroll, inventory
- Payroll expense records linked to payroll runs (when `includeExpenseArtifacts` is enabled)
- Direct JDBC writes to expense tables

### What is NOT simulated
- `core.audit_log` entries (populated by platform services, not the simulator)
- Kafka event-driven side effects between microservices (the **event journal** is naming-only documentation)
- Finance journal/ledger entries beyond expense_record
- Asynchronous platform reactions to data changes

The UI shows the journal table and an amber fidelity note after each execution result.

## Known Limitations

- H2 tests are useful for fast feedback but do not exercise PostgreSQL triggers/views; use the PG tests for full fidelity
- Cleanup on H2 may skip trigger-maintained tables that don't exist in the simplified schema
- Credential export is session-only; there is no way to recover passwords after restart
- PostgreSQL cleanup without Flyway V10 (or without successful `SET LOCAL fern.simulator_cleanup`) may still depend on superuser-only `session_replication_role`, or fail with stock-balance errors
