# FERN Infra Workflow

This directory provides the local-development infrastructure workflow for FERN. It keeps the existing Docker Compose dependency stack, but adds archived-template style operational scripts, runtime folders, and explicit startup and test modes so local behavior is predictable.

## Layout

- `docker-compose.yml`
  - local dependency stack for PostgreSQL primary, PostgreSQL replica, Redis, Kafka, Prometheus, Grafana, Flyway, and DB tools
- `.env.example`
  - base dependency and port configuration copied to `.env`
- `config/services.manifest.sh`
  - authoritative manifest for every local runnable service, its jar path, port variable, and runtime kind
- `env/services.env.example`
  - default local service runtime environment for jar-based startup
- `env/tests.env.example`
  - default test runner configuration
- `scripts/`
  - operational entrypoints for start, stop, restart, health, status, and tests
- `kafka/init-topics.sh`
  - creates the `fern.*` local Kafka topics used by the current architecture
- `postgres/`
  - local PostgreSQL primary and replica configuration, bootstrap, and replication helper scripts
- `redis/redis.conf`
  - explicit Redis configuration used by the local container
- `logs/`
  - local service logs written by `start-services.sh`
- `pids/`
  - PID files for locally started service processes
- `monitoring/`
  - Prometheus and Grafana provisioning files

## Operational Model

FERN now uses two local operating modes:

1. Dependency mode
   - Docker Compose starts PostgreSQL, PostgreSQL replica, Redis, Kafka, Prometheus, and Grafana.
   - Use this when you want infrastructure only.

2. Local service mode
   - Backend services and the gateway are built with Maven and started from local jars.
   - This mirrors the archived template's developer ergonomics while staying native to this Maven reactor.

Compose service containers still exist in `docker-compose.yml` for full-container workflows, but the recommended local developer path is now:

1. `./infra/scripts/start.sh`
2. `./infra/scripts/start-services.sh`
3. `./infra/scripts/test-all-endpoints.sh`

## Scripts

### Dependency lifecycle

- `./infra/scripts/start.sh`
  - starts local dependencies
  - waits for PostgreSQL, replica, Redis, and Kafka health
  - initializes Kafka topics
  - verifies that PostgreSQL primary -> replica streaming replication is actually healthy before reporting dependencies ready
- `./infra/scripts/stop.sh`
  - stops the Docker Compose dependency stack
- `./infra/scripts/status.sh`
  - shows Compose container status and local jar-managed process status
- `./infra/scripts/health-check.sh`
  - checks dependency health and every running local service
  - accepts `--wait SECONDS`
- `./infra/scripts/check-postgres-replication.sh`
  - prints replication-role diagnostics for primary and replica
  - verifies `pg_is_in_recovery()`, WAL sender/receiver status, replay LSNs, and replay timestamp
  - supports `--probe` to perform a real primary-write / replica-read verification
- `./infra/scripts/ensure-postgres-replication.sh`
  - checks that the replica is actively streaming from the primary
  - supports `--repair` to force-recreate and reseed the standby automatically when replication is broken

### Local service lifecycle

- `./infra/scripts/start-services.sh`
  - ensures dependencies are running
  - builds runnable jars with Maven
  - starts `master-node`, all Spring services, and `gateway`
  - writes logs to `infra/logs/`
  - writes PID files to `infra/pids/`
- `./infra/scripts/stop-services.sh`
  - stops only locally launched services
- `./infra/scripts/restart-services.sh`
  - stops then starts local services

### Tests

- `./infra/scripts/test-all-endpoints.sh`
  - gateway/control-plane smoke plus seeded frontend-critical gateway reads
  - validates gateway and direct routing modes
  - validates strict vs explicit dev startup mode expectations
- `./infra/scripts/run-workflow-tests.sh`
  - chained workflow validation across auth, org/product, procurement, sales, HR/payroll, finance, audit, and replica-backed reporting
  - supports `--scenario`, `--skip-seed`, and `--skip-observability`
- `./infra/scripts/seed-workflow-data.sh`
  - resets and reseeds PostgreSQL for workflow validation using `db/seeds/010_workflow_validation_seed.sql`
- `./infra/scripts/reset-workflow-data.sh`
  - convenience wrapper for rebuilding the workflow-validation database state

### Observability and query analysis

- `./infra/scripts/capture-query-plans.sh`
  - captures `EXPLAIN (ANALYZE, BUFFERS)` plans for the curated query pack under `db/query-plans/`
  - supports primary, replica, or both targets
- `./infra/scripts/collect-observability-snapshot.sh`
  - captures `pg_stat_statements`, table/index statistics, replica lag, Kafka topic/group state, and available `/actuator/prometheus` output
- PostgreSQL replication model
  - FERN uses one-way PostgreSQL physical streaming replication: primary -> replica
  - the replica is read-only and does not sync changes back to the primary
  - `DB_URL` must point to the primary for any write-capable service
  - `DB_REPLICA_URL` is for read-only/reporting usage only
  - if you need an end-to-end confirmation, run `./infra/scripts/check-postgres-replication.sh --probe`
  - `./infra/scripts/start.sh` now auto-repairs the standby once at startup if replication is broken
  - this does not provide replica autoscaling; the current Compose topology supports one standby only
- `pg_stat_statements`
  - enabled on both PostgreSQL primary and replica through `infra/postgres/primary/postgresql.conf` and `infra/postgres/replica/setup-replica.sh`
  - auto-created via `infra/postgres/init/01_enable_pg_stat_statements.sh`

## `--dev` Meaning

`--dev` is always explicit. It is never inferred.

### For service startup

When `--dev` is passed to `start-services.sh` or `restart-services.sh`:

- `--dev` is forwarded to every `java -jar` process
- local services run in explicit development mode
- dev-only shared-token fallback behavior in shared libraries is allowed
- the scripts may inject local dev defaults such as the fallback internal token

When `--dev` is not passed:

- the launcher runs in strict mode
- no dev-only flags are appended to service processes
- tests must not rely on dev tokens or local shortcuts

This matches the archived template's explicit opt-in behavior while using FERN's current runtime model.

## `--gateway` Meaning

`--gateway` applies only to the test workflow.

When `--gateway` is passed to `test-all-endpoints.sh`:

- backend checks must go through the gateway
- the suite uses gateway URLs instead of calling service URLs directly
- forwarded responses are validated using gateway response headers such as `X-Gateway-Upstream-Service`
- seeded frontend-critical smoke checks also run through the gateway in this mode
- in strict mode, protected route probes must return `401` when no Bearer JWT is present
- in dev mode, the suite generates a real signed local JWT and expects protected nonexistent probe paths to route and then return downstream `404`
- gateway-forwarded user requests must still enforce downstream outlet and role authorization as the originating user, not as a privileged internal-service bypass

## Browser Frontend Access

The supported browser-local strategy is gateway CORS, not direct service-port access.

Relevant keys in [`services.env.example`](/Users/nguyendinhkhiem/Development/Javas/FERN/infra/env/services.env.example):

- `GATEWAY_CORS_ALLOWED_ORIGINS`
- `GATEWAY_CORS_ALLOWED_METHODS`
- `GATEWAY_CORS_ALLOWED_HEADERS`
- `GATEWAY_CORS_EXPOSED_HEADERS`

The local example defaults allow common frontend dev origins:

- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `http://localhost:3000`
- `http://127.0.0.1:3000`

Frontend developers should still call only the gateway:

- `http://127.0.0.1:8180`

They should not call internal service ports directly.

The in-repo frontend workspace lives at:

- `/Users/nguyendinhkhiem/Development/Javas/FERN/frontend`

Recommended local frontend flow:

```sh
./infra/scripts/start.sh
./infra/scripts/start-services.sh
./infra/scripts/seed-workflow-data.sh
cd frontend
npm install
npm run dev
```

The in-repo frontend proxies `/api` and `/health` to `http://127.0.0.1:8180` by default.
Override that with `VITE_DEV_PROXY_TARGET` when your local gateway runs elsewhere.

Frontend validation flow:

```sh
cd frontend
npm run lint
npm run typecheck
npm run test:run
npm run build
PLAYWRIGHT_PORT=4175 npm run test:e2e
PLAYWRIGHT_PORT=4176 PLAYWRIGHT_LIVE=1 npm run test:e2e:live
```

`test:e2e` is the deterministic mocked suite.
`test:e2e:live` runs against the real seeded gateway stack.
It now checks admin, manager, and cashier behavior, including real or honest-empty states for HR, procurement, sales, payroll, finance, and audit, plus mocked/live coverage for the auth session lifecycle, the newly exposed operational actions, and the public QR/table ordering route.
The live suite also verifies the shared paged-envelope contract on heavy staff lists, the exact protected `/order` cashier queue, and the public order-status refresh flow at `/order/{tableToken}?order={orderToken}`.
Run the mocked and live suites sequentially, not in parallel, so they do not compete for the same managed dev-server port.

When `--gateway` is not passed:

- tests call backend services directly
- this is the strict default mode

## Configuration Files

### `infra/.env`

Base local dependency configuration:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_REPLICATION_USER`
- `POSTGRES_REPLICATION_PASSWORD`
- `POSTGRES_PORT`
- `POSTGRES_REPLICA_PORT`
- `POSTGRES_SCHEMA`
- `REDIS_PORT`
- `KAFKA_PORT`
- `PROMETHEUS_PORT`
- `GRAFANA_PORT`
- service port variables such as `GATEWAY_PORT`, `MASTER_NODE_PORT`, `AUTH_SERVICE_PORT`
- `INTERNAL_SERVICE_TOKEN`
- `WORKER_ID`
- `TEST_WAIT_SECONDS`

### `infra/env/services.env`

Optional overrides for local jar-managed services. If this file does not exist, `services.env.example` is used as the default baseline.

Common keys:

- `DB_URL`
- `DB_REPLICA_URL`
  - `DB_URL` is the primary/write endpoint
  - `DB_REPLICA_URL` is the read-only standby endpoint and must not be used for writes
- `DB_USERNAME`
- `DB_PASSWORD`
- `DB_POOL_SIZE`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_POOL_SIZE`
- `KAFKA_BOOTSTRAP`
- `MASTER_NODE_URL`
- service base URLs used by the gateway
- `INTERNAL_SERVICE_TOKEN`
- `INTERNAL_SERVICE_ALLOWLIST`
- `JWT_SECRET`
- `TOKEN_VERIFIER_URL`
- `TOKEN_SIDECAR_URL`
- `CONTROL_HEARTBEAT_LEASE_SECONDS`
- `CONTROL_HEARTBEAT_INTERVAL_SECONDS`
- `JAVA_OPTS`

### `infra/env/tests.env`

Optional overrides for test execution. If missing, `tests.env.example` is used.

Keys:

- `TEST_WAIT_SECONDS`
- `TEST_TRACE_PREFIX`
- `TEST_DEV_USER_ID`
- `TEST_DEV_USERNAME`
- `TEST_DEV_SESSION_ID`
- `TEST_DEV_ROLES`
- `TEST_DEV_PERMISSIONS`
- `TEST_DEV_OUTLET_IDS`
- `TEST_DEV_JWT_TTL_SECONDS`
- `TEST_GATEWAY_ROUTE_PROBE_PATH`

The gateway smoke suite signs local dev tokens with `JWT_SECRET` using the same HS256 structure as `JwtTokenService`. The helper emits:

- `sub`
- `uid`
- `username`
- `sid`
- `roles`
- `permissions`
- `outletIds`
- `iat`
- `exp`

## Local Service Mapping

These services are managed by `start-services.sh`:

- `master-node` on `8082`
- `auth-service` on `8081`
- `org-service` on `8083`
- `hr-service` on `8084`
- `product-service` on `8085`
- `procurement-service` on `8086`
- `sales-service` on `8087`
- `inventory-service` on `8088`
- `payroll-service` on `8089`
- `finance-service` on `8090`
- `audit-service` on `8091`
- `report-service` on `8092`
- `gateway` on `8080`

The startup order is defined centrally in `config/services.manifest.sh`.

## Common Commands

Start dependencies:

```sh
./infra/scripts/start.sh
```

Start local services in strict mode:

```sh
./infra/scripts/start-services.sh
```

Start local services without rebuilding jars:

```sh
./infra/scripts/start-services.sh --skip-build
```

Start local services in explicit development mode:

```sh
./infra/scripts/start-services.sh --dev
```

Stop local services:

```sh
./infra/scripts/stop-services.sh
```

Stop dependencies:

```sh
./infra/scripts/stop.sh
```

Run direct strict tests:

```sh
./infra/scripts/test-all-endpoints.sh
```

Run gateway strict tests:

```sh
./infra/scripts/test-all-endpoints.sh --gateway
```

Run direct dev tests:

```sh
./infra/scripts/test-all-endpoints.sh --dev
```

Run gateway dev tests:

```sh
./infra/scripts/test-all-endpoints.sh --gateway --dev
```

Run the full chained workflow suite:

```sh
./infra/scripts/run-workflow-tests.sh
```

Run a single workflow chain against the existing database and services:

```sh
./infra/scripts/run-workflow-tests.sh --scenario procurement-chain --skip-seed --skip-observability
```

Capture curated query plans from primary and replica:

```sh
./infra/scripts/capture-query-plans.sh --target both
```

Collect an observability snapshot:

```sh
./infra/scripts/collect-observability-snapshot.sh --tag local-check
```

## Notes

- `setup.sh` now delegates to `scripts/start.sh` for compatibility.
- `setup.bat` keeps a Windows-friendly dependency startup path.
- Database migrations and SQL tests remain under `db/scripts/`.
- The gateway now supports local prefix-based forwarding so `--gateway` is a real execution mode, not a mock path.
- Workflow validation uses strict JWT login by default and relies on the seeded workflow users in `infra/env/tests.env.example`.
- In the Codex desktop environment, local jar services are most reliable when started and tested from the same long-lived shell session.
