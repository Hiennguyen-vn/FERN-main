# Multi-region — Phase 8 Design

> Active-passive cho tier-1 (POS sales + Finance ledger). Triển khai sau khi Phase 1-7 stable trên multi-AZ single-region.

## 1. Scope

**In-scope tier-1**:
- POS sales (sales-service + edge nodes)
- Finance ledger (finance-service)
- Audit log (audit-service)
- Auth (JWT verification)

**Out-of-scope ban đầu**: HR, payroll, report — chấp nhận RTO 4-24h via region restore.

## 2. Topology

```
┌─ region-A (active) ─────────────────┐    ┌─ region-B (passive) ────────────┐
│                                      │    │                                  │
│  Edge POS ──┐                        │    │  Edge POS ──┐                    │
│             ▼                        │    │             ▼                    │
│  Route53 ── gateway-LB (A)           │    │  Route53 ── gateway-LB (B,STBY)  │
│             │                        │    │             │                    │
│             ▼                        │    │             ▼                    │
│  services × N ──── kafka × 3 ──┐     │    │  services × N ──── kafka × 3     │
│  (active)                       │     │    │  (paused / hot-standby)          │
│                                  ▼     │    │                                  │
│  Postgres primary (sync) ───── MirrorMaker2 ──── Postgres standby (logical)    │
│                                  │     │    │                                  │
│  Redis Sentinel + Outbox        │     │    │  Redis Sentinel (warm cache)     │
└──────────────────────────────────┘    └──────────────────────────────────┘
                                  │     │
                                  ▼     ▼
                          MinIO/S3 cross-region replication (async)
```

## 3. Data replication strategy

| Layer | Method | RPO | RTO |
|---|---|---|---|
| Postgres ledger (finance/audit) | Logical replication (pglogical) → standby | < 5s | < 5min (manual promote) |
| Postgres other schemas | Async streaming via WAL shipping → S3 | < 1min | 30min |
| Kafka events | MirrorMaker 2.0 active→passive (mirrored topics) | < 10s | 1min |
| Redis | Skip — passive rebuilds cache from DB on promotion | N/A | 5min cache warm |
| MinIO/S3 | Native cross-region replication (async) | < 1min | N/A (read-anywhere) |
| Vault | Performance replication (Enterprise) hoặc primary-only + region-failover unseal | 0 (KV) | 10min |

## 4. Failover trigger

**Manual** (Phase 8.0): runbook + on-call decision.
**Auto** (Phase 8.1): Route53 health check + Lambda → DNS swap khi region-A unhealthy > 5min.

### Sequence

1. Detect: Prometheus federation alerts firing > N min in region-A.
2. Promote Postgres standby in region-B: `SELECT pg_promote();`.
3. Stop MirrorMaker2 source-side; flip MM2 direction (B → A) for catch-up later.
4. Scale services × N in region-B from 0 → desired.
5. DNS swap: Route53 weighted record region-A=0, region-B=100.
6. Edge POS reconnects via TLS to region-B gateway-LB.
7. Validate: smoke test POS sale → finance ledger → audit chain.

## 5. Constraints + caveats

- **Outbox events** in primary's `core.outbox_event` may not be relayed before region failure → on standby promote, outbox worker continues drain. Idempotent consumers de-dupe.
- **Idempotency keys** in Redis = lost. Falls back to DB tier (`core.idempotency_keys` partitioned table) which IS replicated. Cache cold-start performance penalty.
- **JWT / refresh tokens** in Redis = lost. Users force re-login (acceptable per finance SLO 99.9%).
- **In-flight transactions** at promote time: synchronous_commit=on guarantees no committed data lost; uncommitted txns rolled back.
- **POS edge buffer** absorbs ~RTO window of disconnected operation.

## 6. Cost delta

| Item | Region-A only | Multi-region (active-passive) |
|---|---|---|
| Compute (services + DB) | 1× | ~1.5× (passive at 25% scale) |
| Storage | 1× | 2× (replicated S3 + DB) |
| Cross-region egress | 0 | per-GB MM2 + WAL shipping |
| Operational overhead | normal | runbook + monthly DR drill |

Estimate **+100% infra cost** for tier-1 services only. ROI justified by RPO < 5s on ledger.

## 7. Out-of-scope cho Phase 8.0

- Active-active (multi-master Postgres). Conflict resolution complexity > benefit.
- Edge → multiple regions simultaneously. Edge buffer + single-region affinity sufficient.
- Cross-region Redis Cluster. Cache rebuild on promote acceptable.

## 8. Roll-out checklist

- [ ] Region-B infrastructure provisioned (terraform).
- [ ] Postgres pglogical replication confirmed lag < 5s steady-state.
- [ ] MirrorMaker2 configured for fern.finance.*, fern.audit.*, fern.sales.*.
- [ ] Vault HA with region-B Raft node.
- [ ] Route53 health check + failover record.
- [ ] Runbook reviewed + 1 successful planned failover drill.
- [ ] Game-day exercise simulating region-A loss.
- [ ] SLO dashboards updated cho multi-region (Prometheus federation).

## 9. References

- AWS Multi-Region Application Architecture WhitePaper.
- pglogical for Postgres logical replication: https://github.com/2ndQuadrant/pglogical
- Kafka MirrorMaker 2: https://kafka.apache.org/documentation/#georeplication
- Vault Performance Replication: https://developer.hashicorp.com/vault/docs/enterprise/replication

---

**Status**: Design only. No infrastructure changes until Phase 7 chaos drills consistently pass on multi-AZ + sign-off from finance/operations on RPO/RTO.
