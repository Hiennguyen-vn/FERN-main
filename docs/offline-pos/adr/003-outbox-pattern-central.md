# ADR-003: Transactional Outbox Pattern Central

**Status**: Accepted
**Date**: 2026-04-23

## Context

Hiện tại services publish Kafka inline trong transaction nghiệp vụ (sales-service, product-service, inventory-service, auth-service, org-service). Risk:

- DB commit OK, Kafka publish fail → event mất.
- Kafka publish OK, DB rollback → event ghost.
- Kafka latency spike → block transaction.

## Decision

**Implement transactional outbox pattern central Postgres.**

- Table `core.outbox_event` partitioned monthly via pg_partman.
- Services ghi event vào outbox cùng TX với business data.
- Background `OutboxRelay` poll 1s, `SELECT FOR UPDATE SKIP LOCKED LIMIT 100`, publish Kafka, mark PUBLISHED.
- 2+ relay instance parallel, no leader election (dựa SKIP LOCKED).
- Retention 90 days, drop old partition.
- Retry exponential backoff max 10 attempts → FAILED.

## Consequences

### Positive

- At-least-once delivery guarantee.
- Không mất event khi Kafka down.
- Business transaction không block bởi Kafka latency.
- Consumer idempotent đã có qua `IdempotencyGuard` → safe duplicate.
- Monitoring: queue depth + publish lag visible.

### Negative

- Thêm 1 layer (outbox table + relay) → complexity.
- Relay lag tối thiểu 1s (polling interval).
- Nếu relay down lâu → backlog lớn → spike Kafka khi recover.
- Cần maintain pg_partman extension.

### Mitigation

- Rate limit relay 1000 event/sec per instance.
- Alert lag >30s P2, >5min P1.
- 2+ instance relay cho HA.

## Alternatives Considered

1. **Debezium CDC**: tự động extract changes, push Kafka. Defer sang W8 (dùng cho OLAP sync, không thay thế outbox business event).
2. **Synchronous publish với retry in-memory**: nếu Kafka down lâu, block request. Loại.
3. **Event sourcing toàn bộ**: quá lớn cho scope hiện tại.

## References

- [microservices.io transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
- [docs/offline-pos/06-review-response.md](../06-review-response.md) W1.1
