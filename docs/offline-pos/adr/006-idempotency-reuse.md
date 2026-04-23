# ADR-006: Reuse IdempotencyGuard for Sync

**Status**: Accepted
**Date**: 2026-04-23

## Context

FERN đã có `common/idempotency-core/.../IdempotencyGuard.java` 2-tier (Redis L1 + Postgres L2). Dùng trong SalesService.submitSale (line 139-148) và InventoryEventConsumer.

Sync gateway cần dedup replay từ POS offline: cùng event sync 2 lần phải trả cached result.

## Decision

**Reuse IdempotencyGuard cho /sync/push — không viết lại.**

- Per event: `idempotencyGuard.execute(device_id + event_id, TtlPolicy.BET, () -> handler.apply(payload))`.
- Key = `device_id + event_id` đảm bảo unique global (snowflake event_id đã unique, device_id thêm an toàn).
- TTL = BET (business event TTL ~7 ngày, đủ cho offline 12h + retry buffer).
- Sửa `IdempotencyGuard.lookup()` thêm time window `AND created_at > now() - interval '7 days'` để partition prune.

## Consequences

### Positive

- Zero rebuild effort.
- Unified idempotency semantics toàn hệ thống.
- Redis L1 fast path ~1ms.
- Postgres L2 persistent cho restart safety.

### Negative

- `idempotency_keys` table grow theo volume sync event → partition (W1.5).
- Redis cache memory: TTL 7d * event rate. Ước: 500 sale/outlet/day × 5 event/sale × 30 outlet × 7d ≈ 525k key × 500 byte = 250MB Redis — OK.

## Reference

- `common/idempotency-core/src/main/java/com/dorabets/idempotency/IdempotencyGuard.java`
- [docs/offline-pos/05-implementation-plan.md](../05-implementation-plan.md) W3.2
