# FERN ERP Platform

This repository contains the FERN Java backend plus the first in-repo frontend workspace for gateway-based operations, reporting, and customer table ordering.
The backend remains the system of record and source of truth; the frontend lives under `frontend/` and talks to the gateway only.

The `common/` directory has now been imported from `.archived/common` into the active Maven reactor. The archive remains as historical source material, but the live code that should be built, tested, and extended now lives under the root `common/` directory.

## Repository Layout

- `.mvn/`
  - Maven runtime configuration. The project enables parallel builds through `.mvn/maven.config`.
- `common/`
  - Shared backend libraries used across services.
- `db/`
  - PostgreSQL migrations, seeds, SQL tests, and database documentation.
- `frontend/`
  - Vite + React + TypeScript admin workspace aligned to the current gateway contract.
- `infra/`
  - Local infrastructure workflow, Docker Compose dependencies, lifecycle scripts, logs, pids, and monitoring.
- `services/`
  - Executable backend services.
- `tools/`
  - Internal JVM tools, including the localhost-only operational data simulator web app.
- `pom.xml`
  - Root parent POM for the full reactor.

## Module Graph

```text
fern-backend
|-- common
|   |-- common-utils
|   |-- common-model -> depends on common-utils
|   |-- idempotency-core -> depends on common-utils
|   `-- service-common -> depends on common-utils, common-model, idempotency-core
`-- services
    |-- auth-service
    |   |-- core -> depends on common-model, common-utils
    |   |-- spring -> depends on auth-service-core
    |   `-- aws-lambda -> depends on auth-service-core
    `-- master-node -> depends on common-model, common-utils
```

## Important Namespace Note

The imported shared libraries use two legacy Java package roots:

- `com.natsu.*` in `common-model` and `common-utils`
- `com.dorabets.*` in `idempotency-core` and `service-common`

The Maven artifact coordinates in this repository are standardized under `com.fern`. This means:

- package names reflect imported source history
- artifact coordinates reflect the current repository
- both are valid and intentionally preserved

## Local Development

Prerequisites:

- Java 21
- Maven 3.9+
- Docker with Docker Compose
- Node.js 20+

Start infrastructure:

```sh
./infra/scripts/start.sh
```

If `infra/.env` is missing, the local bootstrap now generates random development-only `JWT_SECRET` and `INTERNAL_SERVICE_TOKEN` values from `infra/.env.example`.

Start local services:

```sh
./infra/scripts/start-services.sh
```

Start the frontend workspace:

```sh
cd frontend
npm install
npm run dev
```

The frontend uses the Vite proxy by default and calls the gateway through `http://127.0.0.1:8082 -> http://127.0.0.1:8180`.
Override the proxy target with `VITE_DEV_PROXY_TARGET` if your local gateway is running elsewhere.
The current checked-in Vite dev server default is `http://127.0.0.1:8082`, so use that port unless you override it explicitly.
The current frontend is read-first with selective write-safe operations: auth session lifecycle, a staff customer-order queue at exact `/order`, sales promotion creation/deactivation, admin payroll create/generate/approve actions, procurement queue actions, and a public QR/table ordering flow at `/order/{tableToken}` with public order-status now run through the real gateway-backed contracts. Remaining intentional follow-up areas are cursor pagination beyond the current paged `limit + offset` envelopes, truly permission-granular navigation, public POS payment, and deeper workflow edits beyond the current operational actions.

Example local customer-ordering route after seeding:

- `http://127.0.0.1:5173/order/tbl_hcm1_u7k29q`

Run the internal simulator app in preview-only mode:

```sh
./infra/scripts/start-data-simulator.sh
```

The built-in simulator defaults no longer create outlets automatically. If you want simulator-owned outlets and operational data, use a custom config or preset override that explicitly enables outlet bootstrap.

Or:

```sh
mvn -pl tools/data-simulator-app -am spring-boot:run
```

Open:

- `http://127.0.0.1:8094`

Enable writes only for a safe local database target:

```sh
./infra/scripts/start-data-simulator.sh --execute
```

Or:

```sh
SIMULATOR_EXECUTION_ENABLED=true mvn -pl tools/data-simulator-app -am spring-boot:run
```

The simulator is intentionally local-only, bypasses the gateway, requires preview before execute, and blocks non-local database targets by default.

**Cleanup and credentials:** Per-run cleanup uses Flyway migration `V10__simulator_cleanup_stock_sync_guard.sql`, which teaches `core.sync_stock_balance` to no-op when `SET LOCAL fern.simulator_cleanup = 'on'` is active so normal database users can delete simulator data without `session_replication_role` (superuser-only). H2 or databases not yet migrated fall back to the replication-role path when the GUC is unavailable. The UI and `cleanup_summary_json` record which path ran (`cleanupMechanism`: `TRIGGER_GUARD`, `REPLICATION_ROLE_FALLBACK`, `H2_COMPAT`, or `NONE`). Execution results also include an in-memory **event journal**: logical event names aligned with `common/event-schemas` for rows the simulator writes — this journal is **not** sent to Kafka. Generated passwords are never persisted; export CSV during the session if you need them. Details: [`docs/data-simulator.md`](docs/data-simulator.md).

Apply database migrations:

```sh
./db/scripts/migrate.sh
```

Run the database SQL tests:

```sh
./db/scripts/run_sql_tests.sh
```

Run the full test suite:

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
```

Run a full package build:

```sh
mvn clean package
```

Run services:

```sh
./infra/scripts/start-services.sh
./infra/scripts/start-services.sh --dev
```

## Documentation Map

- `docs/frontend-startup.md`
  - single start-here guide for frontend integration, local gateway startup, seeded users, and browser access
- `docs/openapi/frontend-surface.json`
  - source-derived machine-readable OpenAPI contract for the current frontend-facing gateway surface
- `docs/README.md`
  - documentation index
- `docs/project-structure.md`
  - root-level structure and ownership
- `docs/erp-microservices-architecture.md`
  - target-state ERP service decomposition, gateway, control-plane, Kafka, Redis, and rollout architecture
- `docs/common-modules.md`
  - imported shared-library guide
- `docs/testing-and-running.md`
  - commands, workflows, and test coverage notes
- `docs/data-simulator.md`
  - internal simulator architecture, safety model, supported parameters, and run guide
- `infra/README.md`
  - local dependency layout, lifecycle scripts, startup modes, and test modes
- `db/README.md`
  - PostgreSQL setup, schema rules, usage examples, and migration commands
- `db/docs/schema-review.md`
  - normalization and PostgreSQL architecture decisions
- `db/docs/data-dictionary.md`
  - table-by-table database reference
- `db/docs/testing-guide.md`
  - SQL test coverage and execution guide
- `common/README.md`
  - shared module overview
- `common/common-model/README.md`
  - cache, datastore, database, and messaging abstractions
- `common/common-utils/README.md`
  - utilities and configuration systems
- `common/idempotency-core/README.md`
  - Redis and PostgreSQL idempotency flow
- `common/service-common/README.md`
  - service harness, auth, repository, and middleware helpers

## Current Verification Status

The repository currently passes:

- `mvn test`

That includes the imported common-module test suites as well as the existing service reactor modules.
