# ADR-007: Monthly Partition via pg_partman

**Status**: Accepted
**Date**: 2026-04-23

## Context

Coffee chain scale: 500 sale/outlet/day × 100 outlet × 365 = 18M sale_record/year, 54M sale_item/year. Partition cần để query báo cáo nhanh + cleanup data cũ.

## Decision

**Monthly partition RANGE `created_at` via pg_partman extension.**

Tables partitioned:

- `sale_record`, `sale_item`, `payment` — `created_at`.
- `inventory_transaction` — `txn_time`.
- `audit_log` — `occurred_at`.
- `outbox_event` (V19) — `created_at`.
- `idempotency_keys` — `created_at` (W1.5 phase 2).

pg_partman:

- Auto-create 12 future partitions.
- Auto-drop per retention policy.
- `SELECT partman.run_maintenance()` nightly 3AM.

PK composite `(id, created_at)` — Postgres yêu cầu partition key trong PK.

FK integrity: denormalize `sale_created_at` trong sale_item → composite FK `(sale_id, sale_created_at)`.

## Consequences

### Positive

- Query báo cáo time-range scan 1 partition → 10-100x faster.
- Drop partition cũ = instant (không VACUUM).
- Index nhỏ per partition.
- pg_partman tự động hóa → zero manual partition management.

### Negative

- Breaking migration — rename old table, create new partitioned, backfill.
- FK composite cần denormalize column `sale_created_at` → app code thay đổi.
- Query without time filter → scan all partitions → performance regression nếu bỏ quên.
- pg_partman cần custom Postgres image (không có sẵn trong `postgres:16-bookworm`).

### Mitigation

- Audit code mọi SELECT hot table → 100% có time filter.
- IdempotencyGuard lookup thêm time window param.
- Dockerfile custom `infra/postgres/Dockerfile` install `postgresql-16-partman`.

## Alternatives Considered

1. **Native Postgres declarative partition (no pg_partman)**: phải tự viết cron tạo/drop partition. Loại vì tự quản lý risk sót.
2. **Citus distribute ngay**: complexity cao, cần shard key setup. Defer đến khi >10M order/day (Polyglot Roadmap).
3. **Không partition, chỉ BRIN index**: OK cho query select, không giúp cleanup data cũ.

## Reference

- [pg_partman docs](https://github.com/pgpartman/pg_partman)
- [docs/offline-pos/07-partitioning-and-pricing.md](../07-partitioning-and-pricing.md)
