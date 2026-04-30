# SPOF Research — FERN ERP

> Tài liệu nghiên cứu cách áp dụng chống Single Point of Failure (SPOF) cho hệ thống FERN.
> Scope: backend microservices (Spring Boot), Postgres, Kafka, Redis, gateway, frontend SPA, infra Docker/K8s.

---

## 1. Bối cảnh hệ thống FERN

### 1.1 Topology hiện tại

| Layer | Component | Vị trí repo |
|---|---|---|
| Edge | Frontend SPA (React) | `frontend/` |
| Edge | POS Edge node (offline-capable) | `FERN-pos-edge/` |
| Gateway | API Gateway (Spring Cloud Gateway) | `gateway/` |
| Services | 12 microservices | `services/{auth,org,product,inventory,procurement,sales,finance,payroll,hr,audit,report,master-node}` |
| Data | Postgres (primary store) | `infra/postgres/` |
| Data | Kafka (event bus) | `infra/kafka/`, `common/event-schemas/` |
| Cache | Redis | `infra/redis/` |
| Pool | PgBouncer | `infra/pgbouncer/` |
| Search/Log | OpenSearch | `infra/opensearch/` |
| Analytics | ClickHouse | `infra/clickhouse/` |
| Object | MinIO | `infra/minio/` |
| Secrets | Vault | `infra/vault/`, `docs/VAULT_INTEGRATION_PLAN.md` |
| Observability | Prometheus + Grafana | `infra/{prometheus,grafana,monitoring}/` |

### 1.2 Đặc thù bài toán ERP

- **Finance + Audit module**: yêu cầu **không mất transaction**, RPO ≈ 0 cho ledger.
- **POS realtime**: cần availability cao trong giờ kinh doanh, có **edge node offline** → đã có buffer chịu lỗi network.
- **Procurement / Inventory event flow**: phụ thuộc Kafka event (`GoodsReceiptPostedEvent`, `InvoiceApprovedEvent`, `ExpenseRecordCreatedEvent`) → mất event = sai sổ sách.
- **Payroll period close**: chạy batch, RTO có thể chấp nhận vài phút nhưng không được mất dữ liệu.
- **Multi-tenant org structure** (`org-service`): mọi service đều resolve org context → org-service down = toàn bộ down.

### 1.3 SPOF inventory (suy ra từ topology hiện tại)

| # | Component | Single? | Blast radius | Module ảnh hưởng | Priority |
|---|---|---|---|---|---|
| 1 | Postgres single instance | Yes (docker-compose) | Toàn hệ thống | All | P0 |
| 2 | Kafka 1 broker | Yes (mặc định compose) | Mọi event flow | Procurement, Finance, Audit, Inventory | P0 |
| 3 | Redis single | Yes | Session, cache | Auth, Gateway, Frontend | P1 |
| 4 | Gateway 1 replica | Yes | Mọi API call | All | P0 |
| 5 | Mỗi service 1 replica | Yes | Module tương ứng | Per-module | P1 |
| 6 | PgBouncer 1 instance | Yes | DB access | All | P1 |
| 7 | Vault 1 node (dev mode) | Yes | Khởi động service mới | Deploy time | P2 |
| 8 | OpenSearch 1 node | Yes | Log search, audit search | Audit, Ops | P2 |
| 9 | MinIO 1 node | Yes | Attachment, export | Procurement, Finance | P2 |
| 10 | ClickHouse 1 node | Yes | Analytics dashboard | Report | P3 |
| 11 | Network egress (1 NIC/ISP) | Yes | External integration | Banking, tax | P2 |
| 12 | DNS provider (1) | Yes | External access | All | P3 |

> Verify thực tế: chạy `docker compose -f infra/docker-compose.yml ps` + `kubectl get deploy -A` để cập nhật cột "Single?".

---

## 2. Nghiên cứu giải pháp per-component

### 2.1 Postgres — P0

**Vấn đề FERN**: ledger finance + audit log không được mất. RPO ≈ 0, RTO < 60s.

**Lựa chọn**:

| Phương án | Pros | Cons | Phù hợp FERN? |
|---|---|---|---|
| Patroni + etcd (3 node) | Open source, full control, sync replica | Vận hành phức tạp, cần DBA | ✅ Khuyến nghị nếu self-host |
| Managed (RDS Multi-AZ, Cloud SQL HA) | Failover tự động, backup tích hợp | Vendor lock-in, chi phí | ✅ Khuyến nghị nếu lên cloud |
| Pgpool-II + streaming replication | Đơn giản hơn Patroni | Failover chậm hơn, split-brain risk | ⚠️ Tránh cho ledger |
| Citus / Postgres-XL | Sharding | Quá nặng cho FERN scale hiện tại | ❌ Over-engineer |

**Khuyến nghị**:

- Sync replica AZ-B + async replica AZ-C.
- `synchronous_commit=on`, `synchronous_standby_names='FIRST 1 (sync_b)'` cho schema finance + audit.
- Schema khác (`report`, analytics) có thể async để giảm latency.
- WAL archiving → MinIO/S3, PITR window 7 ngày.
- PgBouncer × 2 sau keepalived VIP.

**Action mapping**:

- Hiện tại: `infra/postgres/` 1 container. Đổi thành Patroni stack hoặc trỏ về managed.
- Test: `common/test-support/PostgresContainerExtension.java` đã có Testcontainer → thêm test failover scenario dùng 2 container.

### 2.2 Kafka — P0

**Vấn đề FERN**: event finance/procurement không được mất. Schema đã chuẩn hóa trong `common/event-schemas/`.

**Khuyến nghị**:

- Cluster 3 broker, KRaft mode (bỏ ZooKeeper SPOF).
- Topic finance/audit/procurement: `replication.factor=3`, `min.insync.replicas=2`, `acks=all`.
- Topic non-critical (notification, audit-trail UI): `replication.factor=2`, có thể `acks=1`.

**Outbox pattern — bắt buộc cho FERN**:

```sql
CREATE TABLE event_outbox (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  headers JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempt_count INT DEFAULT 0
);
CREATE INDEX idx_outbox_unpublished ON event_outbox (created_at) WHERE published_at IS NULL;
```

- Finance/Procurement service: ghi event vào `event_outbox` cùng transaction nghiệp vụ.
- Worker poll batch → publish Kafka → set `published_at`.
- Idempotent consumer: dedupe key trên `event_id` (đã có sẵn trong schema event).
- DLQ topic `*.dlq` cho fail vĩnh viễn.

**Áp dụng vào FERN events có sẵn**:

- `ExpenseRecordCreatedEvent`, `GoodsReceiptPostedEvent`, `InvoiceApprovedEvent` đều phải qua outbox.
- File liên quan: [ExpenseRecordCreatedEvent.java](common/event-schemas/src/main/java/com/fern/events/finance/ExpenseRecordCreatedEvent.java), [GoodsReceiptPostedEvent.java](common/event-schemas/src/main/java/com/fern/events/procurement/GoodsReceiptPostedEvent.java), [InvoiceApprovedEvent.java](common/event-schemas/src/main/java/com/fern/events/procurement/InvoiceApprovedEvent.java).

### 2.3 Redis — P1

**Vấn đề FERN**: session auth, cache catalog/menu POS, rate limit gateway.

**Khuyến nghị**:

- **Redis Sentinel** (3 sentinel + 1 master + 2 replica) — đơn giản, đủ dùng.
- Spring Boot client: Lettuce với Sentinel config → tự reconnect.
- Code path: cache miss → fallback DB. Wrap bằng Resilience4j circuit breaker.
- POS edge đã có local cache → tolerant với Redis outage trong lúc giao dịch.

**Tránh**: Redis Cluster trừ khi cần > 100GB cache. FERN scale hiện chưa cần.

### 2.4 API Gateway — P0

**Khuyến nghị**:

- Gateway × 2+ replica sau cloud LB (ALB/NLB) hoặc HAProxy + keepalived nếu on-prem.
- Stateless: rate limit state vào Redis (đã có).
- Health check `/actuator/health/readiness` riêng cho upstream check.
- Graceful shutdown: `server.shutdown=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=30s` để drain request.

### 2.5 Microservices — P1

**Mỗi service ≥ 2 replica**. Stateless hóa:

- Session → Redis.
- Idempotency key store → Redis hoặc DB.
- File temp → MinIO, không local disk.
- Scheduled job: dùng `ShedLock` (DB-based) để tránh double-run khi nhiều replica.

**K8s manifest pattern**:

```yaml
spec:
  replicas: 2
  strategy:
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              topologyKey: kubernetes.io/hostname
              labelSelector:
                matchLabels:
                  app: finance-service
---
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  minAvailable: 1
  selector:
    matchLabels: { app: finance-service }
```

**Service đặc biệt**:

- `org-service`: dùng cao tần — cache org tree vào Redis, TTL 5 phút, fallback in-memory cache 30s.
- `auth-service`: JWT stateless → scale tự do. Refresh token vào Redis.
- `master-node`: nếu là leader-election based, dùng K8s Lease API hoặc ShedLock.

### 2.6 POS Edge — đã có resilience

POS edge node ([FERN-pos-edge/](FERN-pos-edge/)) đã offline-capable. Cần verify:

- Local SQLite/IndexedDB queue khi mất kết nối.
- Sync conflict resolution policy (last-write-wins vs CRDT) tài liệu rõ.
- Khi backend Postgres failover, edge phải retry với exponential backoff không gây thundering herd.

### 2.7 Vault — P2

Hiện ở dev mode (`infra/vault/`). Production:

- Vault HA: 3 node với Raft storage backend.
- Auto-unseal qua KMS (AWS KMS / GCP KMS).
- App side: cache secret 5 phút trong memory, retry khi Vault tạm down → service không chết khi Vault restart.
- Tham chiếu: [VAULT_INTEGRATION_PLAN.md](VAULT_INTEGRATION_PLAN.md).

### 2.8 OpenSearch / ClickHouse / MinIO — P2-P3

| Component | Khuyến nghị |
|---|---|
| OpenSearch | Cluster 3 master + 2+ data, replica shard ≥ 1 |
| ClickHouse | Replicated tables (Keeper coord), 2 replica |
| MinIO | Distributed mode, erasure coding (4+ node) |

Không critical với business flow trực tiếp → ưu tiên sau P0/P1.

### 2.9 Frontend SPA

- Build static → CDN (CloudFront/Cloudflare). CDN multi-edge tự bản chất không SPOF.
- `index.html` cache TTL ngắn, asset hash dài.
- Service Worker cache shell → user thấy UI ngay cả khi backend slow (graceful degradation).
- Error boundary + retry logic trong `frontend/src/api/*-api.ts` đã cần — verify có exponential backoff.

---

## 3. Resilience patterns áp dụng

| Pattern | Áp dụng ở đâu trong FERN |
|---|---|
| Circuit breaker (Resilience4j) | Mọi inter-service call qua `WebClient`/Feign |
| Retry với backoff | Kafka producer, outbox worker, external API (banking, tax) |
| Bulkhead | Thread pool riêng cho external integration vs internal |
| Timeout | Mọi HTTP client default 5s, DB query 30s |
| Idempotency | Header `X-Idempotency-Key` cho POST tạo đơn (procurement, sales, payroll run) |
| Saga | Procurement flow (PO → GR → Invoice → Payment) cross-service |
| Outbox | Tất cả event finance/procurement/audit |
| Compensating transaction | Saga rollback khi 1 bước fail |
| Health check tách | Liveness vs readiness — readiness check dependency, liveness chỉ self |

---

## 4. Lộ trình áp dụng (mapping với phase plan)

| Phase | Mục tiêu | File/module FERN cần đụng |
|---|---|---|
| 0. Audit | Cập nhật bảng SPOF inventory thực tế | Tạo `docs/spof-inventory.md` |
| 1. Quick wins | Replica 2x, anti-affinity, PDB, health check | Manifest K8s mỗi service |
| 2. Postgres HA | Patroni hoặc managed | `infra/postgres/`, `infra/pgbouncer/` |
| 3. Stateless + Redis HA | Sentinel, session ra Redis | `infra/redis/`, `auth-service`, gateway |
| 4. Event reliability | Outbox + Kafka 3 broker | `services/{finance,procurement,audit}`, `infra/kafka/` |
| 5. Multi-AZ | Spread node pool | Helm values, terraform |
| 6. Observability | SLO + alert per module | `infra/prometheus/`, `infra/grafana/` |
| 7. Chaos | Game day, runbook | `docs/RUNBOOKS/` |
| 8. Multi-region | Active-passive cho tier-1 | Sau Q3, chỉ POS + Finance |

---

## 5. Test scenarios cụ thể FERN

### 5.1 Failover Postgres giữa giờ peak POS

- Steps: kill primary Postgres khi POS đang ghi sales.
- Expect: POS edge buffer giao dịch, retry sau ≤ 60s, không mất bill.
- Verify: `sales-service` log không có `unique violation`, ledger finance khớp số.

### 5.2 Kafka broker loss khi finance close period

- Steps: kill 1/3 broker khi `payroll-service` đang publish payroll posted event.
- Expect: producer retry, không mất event, period close hoàn tất.
- Verify: `event_outbox.published_at` set đầy đủ, audit log khớp.

### 5.3 org-service down

- Steps: scale `org-service` về 0.
- Expect: các service khác dùng Redis cache org tree → tiếp tục serve trong 5 phút.
- Sau 5 phút: graceful degradation, trả error rõ ràng, không cascade crash.

### 5.4 Redis Sentinel master fail

- Steps: kill Redis master.
- Expect: Sentinel promote replica < 30s. Auth service tiếp tục verify JWT (vì stateless), refresh token tạm fail → user re-login.

### 5.5 AZ outage

- Steps: cordon + drain toàn bộ node AZ-A.
- Expect: tất cả service vẫn serve qua AZ-B/C. Postgres sync standby promote nếu primary ở AZ-A.

---

## 6. Metric & SLO đề xuất

| Module | Availability SLO | Latency p99 | RPO | RTO |
|---|---|---|---|---|
| POS sales | 99.95% (giờ KD) | < 500ms | 0 (edge buffer) | 30s |
| Finance ledger | 99.9% | < 1s | 0 | 60s |
| Procurement | 99.5% | < 2s | < 1 phút | 5 phút |
| HR / Payroll | 99.0% | < 3s | < 5 phút | 30 phút |
| Audit search | 99.0% | < 5s | < 5 phút | 1 giờ |
| Report / Analytics | 95.0% | < 10s | < 1 giờ | 4 giờ |

Alert rule:

- Burn rate fast (1h window) > 14.4× → page.
- Burn rate slow (6h window) > 6× → ticket.
- Postgres replication lag > 10s → warn, > 60s → page.
- Kafka under-replicated partition > 0 trong 5 phút → page.

---

## 7. Risk & cost

| Phase | Infra cost delta | Effort (dev-week) | Risk khi triển khai |
|---|---|---|---|
| 1 | +10% (replica 2x) | 1 | Thấp |
| 2 | +30% (DB HA) | 3 | Trung — cần migration window |
| 3 | +5% (Redis Sentinel) | 1 | Thấp |
| 4 | +20% (Kafka 3 broker + outbox) | 4 | Trung — đụng schema |
| 5 | +50% (multi-AZ) | 2 | Thấp |
| 6 | +5% (storage metric) | 2 | Thấp |
| 7 | 0 | 2 | Thấp (làm staging) |
| 8 | +100% (multi-region) | 6 | Cao |

---

## 8. Tham chiếu nội bộ

- [ARCHITECTURE_REPORT.md](ARCHITECTURE_REPORT.md)
- [erp-microservices-architecture.md](erp-microservices-architecture.md)
- [VAULT_INTEGRATION_PLAN.md](VAULT_INTEGRATION_PLAN.md)
- [RUNBOOKS/](RUNBOOKS/)
- [common/event-schemas/](../common/event-schemas/)
- [infra/](../infra/)

## 9. Tham chiếu ngoài

- Patroni: https://github.com/patroni/patroni
- Outbox pattern (Debezium): https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
- Resilience4j: https://resilience4j.readme.io/
- Google SRE Book — Chapter on SLO: https://sre.google/sre-book/service-level-objectives/
- Kafka KRaft + replication: https://kafka.apache.org/documentation/#replication
- AWS Well-Architected — Reliability Pillar.

---

## 10. Next action

1. Verify SPOF inventory thực tế (chạy `docker compose ps` + `kubectl get deploy -A`).
2. Tạo `docs/spof-inventory.md` với cột thực tế.
3. Mở epic Phase 1 (replica 2x + PDB + anti-affinity).
4. Schedule design review Phase 2 (Postgres HA) — quyết self-host Patroni vs managed.
