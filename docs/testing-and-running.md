# Testing And Running

## Prerequisites

- Java 21
- Maven 3.9 or newer
- Docker with Docker Compose

## Start Local Infrastructure

```sh
cp infra/.env.example infra/.env
./infra/scripts/start.sh
```

This starts:

- PostgreSQL
- Redis
- Kafka
- Prometheus
- Grafana

## Start Local Services

Strict mode:

```sh
./infra/scripts/start-services.sh
```

Explicit development mode:

```sh
./infra/scripts/start-services.sh --dev
```

What changes with `--dev`:

- the launcher forwards `--dev` to every `java -jar` process
- dev-only shared-library behavior is enabled explicitly
- no local service enters dev mode unless this flag is present

Stop local services:

```sh
./infra/scripts/stop-services.sh
```

Restart local services:

```sh
./infra/scripts/restart-services.sh
./infra/scripts/restart-services.sh --dev
```

Inspect status and health:

```sh
./infra/scripts/status.sh
./infra/scripts/health-check.sh
./infra/scripts/health-check.sh --wait 90
```

Run local infra smoke tests:

```sh
./infra/scripts/test-all-endpoints.sh
./infra/scripts/test-all-endpoints.sh --gateway
./infra/scripts/test-all-endpoints.sh --dev
./infra/scripts/test-all-endpoints.sh --gateway --dev
```

Mode rules:

- `--gateway` forces the test suite to send backend checks through the gateway instead of calling services directly
- `--dev` explicitly enables dev-only test behavior such as dev token generation and startup-mode assertions
- without `--dev`, tests run in strict mode
- locally signed JWTs are a test convenience in both strict and dev modes; they are not the runtime definition of dev mode

## Frontend Startup

Frontend developers should start with:

- [`frontend-startup.md`](/Users/nguyendinhkhiem/Development/Javas/FERN/docs/frontend-startup.md)
- [`frontend-surface.json`](/Users/nguyendinhkhiem/Development/Javas/FERN/docs/openapi/frontend-surface.json)

Recommended local path:

```sh
./infra/scripts/start.sh
./infra/scripts/start-services.sh
./infra/scripts/seed-workflow-data.sh
./infra/scripts/test-all-endpoints.sh --gateway
cd frontend
npm install
npm run dev
```

The in-repo frontend proxies `/api` and `/health` to `http://127.0.0.1:8180` by default.
Override that with `VITE_DEV_PROXY_TARGET` if your local gateway runs elsewhere.

The gateway smoke suite now includes seeded frontend-critical checks for:

- login
- me
- one org read
- one product read
- one report read
- one `401`
- one `403`

## Internal Data Simulator

The repository now includes a localhost-only internal simulator app at:

- `/Users/nguyendinhkhiem/Development/Javas/FERN/tools/data-simulator-app`

Use it to preview and execute deterministic operational datasets directly into a safe local database.

Preview-only startup:

```sh
cd /Users/nguyendinhkhiem/Development/Javas/FERN
./infra/scripts/start-data-simulator.sh
```

Or:

```sh
cd /Users/nguyendinhkhiem/Development/Javas/FERN
mvn -pl tools/data-simulator-app -am spring-boot:run
```

Open:

- `http://127.0.0.1:8094`

Writes are disabled by default. Enable them explicitly only for a safe local target:

```sh
cd /Users/nguyendinhkhiem/Development/Javas/FERN
./infra/scripts/start-data-simulator.sh --execute
```

Or:

```sh
cd /Users/nguyendinhkhiem/Development/Javas/FERN
SIMULATOR_EXECUTION_ENABLED=true mvn -pl tools/data-simulator-app -am spring-boot:run
```

The simulator:

- runs day-by-day through `SimulationEngine` with 6 chronological phases
- binds to `127.0.0.1`
- is not routed through the gateway
- requires preview before execute with an explicit confirmation dialog
- shows day-by-day progress with current date, counts, and month summaries during execution
- persists run metadata in `core.simulator_run` (survives restart), including cleanup audit fields after per-run cleanup (Flyway V10+)
- uses `SET LOCAL fern.simulator_cleanup` on PostgreSQL (after migration V10) so cleanup does not require superuser `session_replication_role`; passwords are never persisted (`credentialCount` only)
- blocks non-local or production-looking DB targets unless explicitly overridden

Module validation:

```sh
cd /Users/nguyendinhkhiem/Development/Javas/FERN
mvn -pl tools/data-simulator-app -am compile
mvn -pl tools/data-simulator-app -am test
```

Run the opt-in large-scenario test (H2, 5-year multi-outlet):

```sh
mvn -pl tools/data-simulator-app test -Dsimulator.large.test=true -Dtest=SimulationExecutionIntegrationTest
```

Run high-fidelity PostgreSQL integration tests (requires Docker). These apply migrations through **V10** and cover cleanup preview vs execute totals, persisted cleanup JSON, credential in-memory flags, and non-superuser cleanup:

```sh
mvn -pl tools/data-simulator-app test -Dsimulator.pg.test=true -Dtest=PostgresIntegrationTest
```

Run PostgreSQL-backed large-scenario test:

```sh
mvn -pl tools/data-simulator-app test -Dsimulator.pg.test=true -Dsimulator.large.test=true -Dtest=PostgresIntegrationTest
```

Simulator Playwright browser tests (requires the simulator running on port 8094):

```sh
cd /Users/nguyendinhkhiem/Development/Javas/FERN/tools/data-simulator-app/e2e
npm install
npx playwright install chromium
npx playwright test
```

See [`data-simulator.md`](/Users/nguyendinhkhiem/Development/Javas/FERN/docs/data-simulator.md) for the supported scenario parameters, workflow generation order, safety guarantees, and limitations.

**Simulator test tiers:**

| Suite | Command | Guarantees | Does *not* guarantee |
|-------|---------|------------|----------------------|
| Default module tests | `mvn -pl tools/data-simulator-app -am test` | Unit/controller logic, H2 engine smoke | PG triggers, enum parity, cleanup GUC path |
| H2 integration | included above; optional `-Dsimulator.large.test=true` | Long-run engine stability on approximate schema | Production-identical cleanup or stock guards |
| PostgreSQL (Testcontainers) | `-Dsimulator.pg.test=true -Dtest=PostgresIntegrationTest` | Full Flyway schema through V10, `cleanupMechanism` in persisted JSON, non-superuser cleanup, real triggers | — |
| PG large (opt-in) | add `-Dsimulator.large.test=true` | Multi-year run on real PG | — |

## Frontend Validation

```sh
cd frontend
npm run lint
npm run typecheck
npm run test:run
npm run build
PLAYWRIGHT_PORT=4175 npm run test:e2e
```

The default frontend Playwright suite uses mocked gateway responses so it can validate:

- login UX
- refresh/logout/session lifecycle UI
- session-expired handling
- forbidden route handling for users without outlet scope
- role-aware navigation
- protected staff `/order` queue visibility and forbidden direct-route behavior
- HR, procurement, sales, payroll, finance, and audit page states
- promotion, payroll, and procurement operational actions through mocked gateway contracts
- public QR/table ordering success, invalid-token, unavailable-table, item-conflict, and insufficient-stock states
- public order-status refresh for a submitted table order
- end-to-end cashier order create -> approve -> payment flow from `/pos`
- end-to-end public-order submit plus staff approve/payment flow from protected staff routes
- not-found routing

Run the live seeded-user suite through the gateway after infra and services are running:

```sh
cd frontend
PLAYWRIGHT_PORT=4176 PLAYWRIGHT_LIVE=1 npm run test:e2e:live
```

The live suite validates:

- real gateway login with seeded users
- role-aware navigation differences between admin, scoped manager, and cashier users
- forbidden access to admin-only modules
- hierarchy, catalog, pricing, inventory, reports, HR, procurement, sales, payroll, finance, and audit page states
- real scoped content or honest empty states for HR, procurement, and sales
- real admin page content and honest empty states for payroll, finance, and audit
- public customer ordering from `/order/{tableToken}` against the live seeded gateway stack
- public order-status refresh from `GET /api/v1/sales/public/tables/{tableToken}/orders/{orderToken}`
- cashier order lifecycle in `/pos`, including public-order approval and payment completion

Run mocked and live Playwright sequentially, not in parallel, and keep distinct `PLAYWRIGHT_PORT` values so the managed dev server is not shared between suites.

## Run the Full Test Suite

```sh
mvn test
```

What this currently covers:

- `common-utils` unit tests
- `common-model` unit tests
- `service-common` unit and lightweight HTTP middleware tests
- service modules that currently have no test sources still compile in the reactor

## Useful Focused Commands

Run only the imported shared-library tests:

```sh
mvn -pl common/service-common -am test
```

Run only the model layer:

```sh
mvn -pl common/common-model -am test
```

Run only the utilities layer:

```sh
mvn -pl common/common-utils -am test
```

Run a clean package:

```sh
mvn clean package
```

## What Was Fixed During Import

The imported common modules needed two repository-specific adjustments:

- the shared modules were converted from Gradle module definitions to Maven POMs
- the archived repository regression test was rewritten to validate this repository instead of an older Gradle layout
- the Javalin test path needed explicit Jetty 11 alignment to avoid mixed Jetty versions from BOM management

## Known Notes

- Mockito emits JDK warnings about dynamic agent loading during some tests. The tests still pass.
- `service-common` uses Javalin internally even though the executable services are Spring Boot apps.
- `idempotency-core` has no direct tests yet, but it is compiled and exercised as a dependency of `service-common`.
