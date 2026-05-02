# Ke Hoach Xu Ly Review Kien Truc FERN

## Muc Tieu

Ke hoach nay chuyen 11 findings kien truc thanh backlog ky thuat co the thuc thi. Muc tieu la dua FERN tu trang thai pilot/mid-scale len nen tang san sang hon cho production multi-location:

- Giam rui ro downtime tai cua hang trong gio cao diem.
- Lam ro ownership giua cac service.
- Tang tinh dung dan cua sync/offline/event replay.
- Siết bao mat service-to-service va du lieu multi-outlet.
- Lam migration, reporting va observability phu hop van hanh chuoi lon.

## Nguyen Tac Thuc Hien

- Xu ly truoc cac loi co the gay mat du lieu, double-count, bypass security hoac downtime.
- Moi thay doi P1 phai co regression test.
- Khong sua schema production theo cach pha backward compatibility neu chua co migration/rollback.
- Uu tien thay doi nho, co feature flag neu anh huong runtime.
- Moi thay doi lien quan auth, inventory, payment, outbox phai co test idempotency/concurrency.

## Tong Hop Uu Tien

| Priority | Finding | Hang muc | Ket qua mong doi |
| --- | --- | --- | --- |
| P1 | F8 | Gateway rate limiter | Rate limit thuc su duoc gan vao route va co test |
| P1 | F9 | Telemetry route/auth | POS device gui telemetry qua gateway thanh cong |
| P1 | F3 | Outbox stable event id | Replay cung outbox row khong tao event id moi |
| P1 | F10 | Inventory single writer | Khong con hai nguon quyet dinh khau tru ton |
| P1 | F11 | pg_partman idempotency | SQL tests/migration chay lai khong fail |
| P1 | F1 | Internal service identity | Giam blast radius cua shared internal token |
| P1 | F2 | RLS + PgBouncer | Query RLS an toan voi pooling strategy |
| P2 | F4 | Outbox reclaim tuning | Khong reclaim qua som khi Kafka cham |
| P2 | F5 | Report role hardening | Khong hardcode password, giam quyen doc core |
| P2 | F6 | WebSocket token exposure | Khong truyen JWT dai han qua query string |
| P2 | F7 | Auth error serialization | JSON loi hop le, khong noi chuoi thu cong |

## Phase 0 - Baseline Va Guardrails

### Viec can lam

1. Tao branch rieng cho hardening.
2. Chay baseline test hien tai:
   - `mvn -pl gateway,services/sales-service,services/inventory-service,services/product-service,services/report-service -am test`
   - `./db/scripts/run_sql_tests.sh`
   - `cd FERN-pos-edge/agent && npm run typecheck && npm test`
   - `cd FERN-pos-edge && npm run build`
   - `cd frontend && npm run typecheck && npm run test:run`
3. Ghi lai test dang fail truoc khi sua. Hien tai SQL integrity test fail o `V26_5__pg_partman_setup.sql`.

### Tieu chi hoan thanh

- Co log baseline truoc/sau.
- Moi P1 sau khi sua co it nhat mot test bat loi cu.

## Phase 1 - Gateway Enforcement Va POS Telemetry

### F8 - Gan Rate Limiter Vao Route

File lien quan:

- `gateway/src/main/java/com/fern/gateway/config/GatewayRoutesConfiguration.java`
- `gateway/src/test/java/com/fern/gateway/config/*`

Ke hoach:

1. Trong route filter chain, them `filters.requestRateLimiter(...)`.
2. Gan dung `RedisRateLimiter` theo policy:
   - auth: login/token endpoint.
   - sync: POS sync/push/pull.
   - report: report endpoints.
   - default: cac endpoint con lai.
3. Dung `gatewayRateLimitKeyResolver` da co san.
4. Them unit test hoac slice test verify route co `RequestRateLimiterGatewayFilterFactory`.

Tieu chi nghiem thu:

- Auth/sync/report routes co request-rate-limiter filter.
- Test fail neu bo request limiter khoi route.
- Config rate limit co the override qua env/property neu can.

### F9 - Sua Route Va Auth Cho POS Telemetry

File lien quan:

- `gateway/src/main/java/com/fern/gateway/routing/GatewayRouteCatalog.java`
- `gateway/src/main/java/com/fern/gateway/security/GatewayAuthenticationFilter.java`
- `common/service-common/src/main/java/com/fern/common/spring/auth/RequestAuthenticationFilter.java`
- `services/sales-service/src/main/java/com/fern/services/sales/api/TelemetryController.java`

Ke hoach:

1. Them route `/api/v1/telemetry` ve `sales-service`.
2. Dong bo `isDevicePath` o gateway va service-common de telemetry chap nhan device JWT.
3. Them test:
   - Device JWT goi `/api/v1/telemetry` thanh cong qua gateway.
   - User JWT goi telemetry bi reject neu endpoint yeu cau device context.
   - Internal spoof headers bi strip va khong bypass duoc.

Tieu chi nghiem thu:

- POS edge gui telemetry qua gateway thanh cong.
- `TelemetryController.requireDeviceContext()` duoc thoa man voi device JWT hop le.
- Khong mo telemetry cho user/session token.

## Phase 2 - Outbox/Event Idempotency

### F3 - Event ID Phai Stable Khi Replay

File lien quan:

- `common/service-common/src/main/java/com/fern/common/outbox/OutboxRelay.java`
- `common/service-common/src/main/java/com/fern/common/spring/events/TypedKafkaEventPublisher.java`
- `db/migrations/V19__outbox.sql`
- Cac consumer dung `IdempotencyGuard`.

Ke hoach:

1. Mo rong publisher de publish envelope voi event id do caller truyen vao.
2. OutboxRelay dung `outbox_event.id` hoac stable `event_key` lam `eventId`.
3. Dam bao payload Kafka cua cung outbox row khong thay doi eventId sau retry/reclaim.
4. Them test:
   - Cung outbox row publish 2 lan sau reclaim co cung `eventId`.
   - Consumer idempotency skip duplicate event.

Tieu chi nghiem thu:

- Event replay khong tao UUID moi.
- Duplicate delivery tu Kafka/outbox khong tao side effect moi.

### F4 - Dieu Chinh Batch/Reclaim Cho Outbox

File lien quan:

- `common/service-common/src/main/java/com/fern/common/outbox/OutboxRelay.java`
- Cac `OutboxDrainJob`.

Ke hoach:

1. Dua `BATCH_LIMIT`, `PROCESSING_RECLAIM_SECONDS`, timeout publish ra config.
2. Dat reclaim timeout > worst-case publish time cua batch, hoac cap nhat heartbeat per event.
3. Can nhac claim nho hon, vi du 10-25 events, neu publish synchronous.
4. Them metric:
   - processing age max.
   - reclaim count.
   - publish duration p95/p99.

Tieu chi nghiem thu:

- Kafka cham khong lam hai instance publish cung event qua som.
- Co alert neu event nam PROCESSING qua nguong.

## Phase 3 - Inventory Ownership Va BOM Modifier

### F10 - Chon Single Writer Cho Inventory Ledger

File lien quan:

- `services/sales-service/src/main/java/com/fern/services/sales/infrastructure/SalesRepository.java`
- `services/inventory-service/src/main/java/com/fern/services/inventory/application/InventoryService.java`
- `services/inventory-service/src/main/java/com/fern/services/inventory/infrastructure/InventoryRepository.java`
- `db/migrations/V55__modifier_recipe_effect.sql`

Khuyen nghi kien truc:

- `inventory-service` la single writer cho stock ledger.
- `sales-service` chi approve order va emit `sale-approved`.
- Neu can fail-fast khi het ton, sales goi inventory availability/reservation API hoac doc read model `stock_available`, nhung khong ghi `inventory_transaction`.

Ke hoach:

1. Viet test chung cho sale co modifier:
   - `MULTIPLY`
   - `SCALE_ITEM`
   - `SUBSTITUTE`
   - `ADD`
2. Tam thoi, sua logic de sales-service khong ghi base recipe neu inventory-service se xu ly event.
3. Dam bao inventory consumer idempotent theo `(sale_id, product_id, item_id)` va modifier-aware.
4. Xu ly offline POS:
   - Local reservation can co modifier-aware BOM hoac chap nhan reservation conservative.
   - Central reconciliation phai chinh xac khi sync lai.
5. Cap nhat contract event neu `SaleApprovedEvent` chua mang modifier option ids can thiet.

Tieu chi nghiem thu:

- Cung mot sale khong double-deduct.
- Sale co modifier khau tru dung nguyen vat lieu.
- Replay `sale-approved` khong tao inventory transaction moi.
- Offline sale sync len central ra cung stock ledger voi online sale.

## Phase 4 - Database Migration Va Pooling

### F11 - pg_partman Migration Idempotent

File lien quan:

- `db/migrations/V26_5__pg_partman_setup.sql`
- `db/scripts/reset.sh`
- `db/scripts/run_sql_tests.sh`

Ke hoach:

1. Boc `partman.create_parent` bang check `partman.part_config`.
2. Neu parent da ton tai, chi `UPDATE part_config`.
3. Reset test can clean metadata partman lien quan test DB, hoac migration phai hoan toan idempotent.
4. Them SQL test chay migration 2 lan tren DB reused.

Tieu chi nghiem thu:

- `./db/scripts/run_sql_tests.sh` pass.
- Re-run migration tren infra da co `partman.part_config` khong fail.

### F2 - RLS Scope Va PgBouncer

File lien quan:

- `common/service-common/src/main/java/com/fern/common/repository/BaseRepository.java`
- `infra/pgbouncer/README.md`
- Cac repository query autoCommit.

Ke hoach:

1. Chon mot trong hai huong:
   - Huong A: moi query deu chay trong transaction va dung `SET LOCAL`.
   - Huong B: khong dung PgBouncer transaction pooling cho app role can RLS GUC.
2. Neu chon A, refactor `queryOne/queryList/execute` de `conn.setAutoCommit(false)`, `SET LOCAL`, execute, commit.
3. Them integration test voi PgBouncer neu co stack.
4. Cap nhat README de khong khuyen dung transaction pooling khi chua refactor.

Tieu chi nghiem thu:

- Outlet scope khong ro ri giua requests.
- Query qua PgBouncer khong fail-closed bat thuong.
- Tai lieu pooling strategy ro rang.

## Phase 5 - Security Hardening

### F1 - Thay Shared Internal Token Bang Service Identity

File lien quan:

- `common/service-common/src/main/java/com/fern/common/spring/auth/SpringInternalServiceAuth.java`
- `gateway/src/main/java/com/fern/gateway/security/GatewayAuthenticationFilter.java`
- `infra/env/services.env.example`
- Vault/IaC configs.

Ke hoach ngan han:

1. Bat buoc `INTERNAL_SERVICE_ALLOWLIST` trong non-dev.
2. Khong cho internal service tu khai user roles/outletIds tru khi service la gateway.
3. Tach token theo service thay vi shared token neu chua co mTLS.
4. Log audit internal call voi serviceName, route, correlationId.

Ke hoach dai han:

1. Dung mTLS service mesh hoac signed service JWT.
2. Service token co `sub`, `aud`, `scope`, `exp`, `kid`.
3. Downstream validate endpoint policy theo `scope`, khong chi validate token.

Tieu chi nghiem thu:

- Service khong phai gateway khong the forward user roles/outletIds.
- Compromise mot service khong tu dong co quyen cross-outlet toan he thong.

### F5 - Report Role Va Secret Management

File lien quan:

- `db/migrations/V59__db_hardening.sql`
- `infra/vault/*`
- `services/report-service/src/main/resources/application.yml`

Ke hoach:

1. Bo hardcoded password khoi migration.
2. Tao role/credential bang IaC/Vault bootstrap, khong bang Flyway app migration.
3. Giam quyen `fern_report`:
   - SELECT tren reporting views/materialized views.
   - Khong SELECT ALL core tables mac dinh.
4. Mask/loai PII khoi read model neu khong can.

Tieu chi nghiem thu:

- Khong co password production hardcoded trong migration.
- Report-service doc duoc report can thiet nhung khong doc duoc bang PII ngoai scope.

### F6 - WebSocket Token Exposure

File lien quan:

- `gateway/src/main/java/com/fern/gateway/ws/WebSocketSyncHandler.java`
- POS edge client WebSocket code.

Ke hoach:

1. Uu tien Authorization header trong WebSocket handshake neu client ho tro.
2. Neu bat buoc query param, dung one-time short-lived WS token:
   - TTL 30-60 giay.
   - Bind vao outlet/device/session.
   - Revoke sau khi connect.
3. Dam bao access logs/proxy logs redact `token`.

Tieu chi nghiem thu:

- JWT dai han khong xuat hien trong URL.
- Log khong chua token.

### F7 - Serialize Loi Auth Bang ObjectMapper

File lien quan:

- `common/service-common/src/main/java/com/fern/common/spring/auth/RequestAuthenticationFilter.java`
- `common/service-common/src/main/java/com/fern/common/spring/web/ServiceExceptionHandler.java`

Ke hoach:

1. Inject `ObjectMapper` vao filter.
2. Dung common error body DTO/map.
3. Them test message co quote/newline khong lam JSON malformed.

Tieu chi nghiem thu:

- Moi error response la valid JSON.
- Khong noi chuoi JSON thu cong.

## Phase 6 - Reporting, Observability Va Frontend Maintainability

### Reporting

Ke hoach:

1. Chuyen doanh thu theo ngay sang `business_date`.
2. Them report authorization cho cross-outlet/region.
3. Xay projection cho realtime:
   - Kafka consumer -> ClickHouse/materialized reporting table.
   - Dashboard khong query OLTP hot tables truc tiep.

Tieu chi nghiem thu:

- Report ca dem/timezone dung.
- Manager chi xem dung outlet/region duoc cap quyen.
- Dashboard chain-level khong lam tang lock/load len OLTP.

### Observability

Ke hoach:

1. Dashboard theo outlet/device:
   - POS `last_seen`.
   - local outbox depth/lag.
   - failed sync count.
   - API p95/p99.
   - Kafka consumer lag.
   - DB lock/deadlock.
   - payment pending.
   - negative stock/oversell/waste/cash variance.
2. Alert:
   - POS offline > 5 phut trong gio ban hang.
   - sync lag > 2 phut.
   - outbox failed > 0 trong 5 phut.
   - DB deadlock > 0.
   - replica lag > 10 giay warning, > 60 giay page.

### Frontend

Ke hoach:

1. Tach cac module frontend > 1000 dong thanh component/use-case nho.
2. Lazy-load module HQ lon.
3. Tao API client typed contract theo domain.
4. Them tests cho permission/route guards va flows POS/HQ quan trong.

## Test Plan Tong Hop

Backend:

```bash
mvn -pl gateway,services/sales-service,services/inventory-service,services/product-service,services/report-service -am test
```

SQL:

```bash
./db/scripts/run_sql_tests.sh
```

POS edge agent:

```bash
cd FERN-pos-edge/agent
npm run typecheck
npm test
```

POS edge app:

```bash
cd FERN-pos-edge
npm run build
```

HQ frontend:

```bash
cd frontend
npm run typecheck
npm run test:run
```

Them test moi:

- Gateway route filter test cho rate limiter.
- Telemetry route/auth test.
- Outbox replay stable event id test.
- Inventory modifier BOM integration test.
- SQL idempotency test cho pg_partman.
- RLS + pooling integration test neu co PgBouncer stack.

## Thu Tu Trien Khai De Giam Rui Ro

1. Gateway rate limiter + telemetry route/auth.
2. pg_partman idempotency de unblock SQL integrity tests.
3. Outbox stable event id va reclaim tuning.
4. Inventory single-writer refactor.
5. Internal service identity hardening.
6. Report role/RLS/PgBouncer hardening.
7. WebSocket token hardening va auth JSON cleanup.
8. Reporting projection va observability dashboard.

## Definition Of Done

- Tat ca test baseline pass.
- Moi finding co test regression hoac migration validation.
- Khong con P1 mo trong backlog.
- Production runbook cap nhat cho:
  - gateway rate limits.
  - outbox replay.
  - inventory reconciliation.
  - migration dry-run.
  - POS offline/sync monitoring.
- Dashboard co alert cho POS offline, sync lag, outbox lag, DB lock/deadlock va Kafka lag.

