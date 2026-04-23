# Architecture Decision Records — Offline-First POS

Mỗi ADR = 1 quyết định quan trọng + lý do + hệ quả.

Format: MADR-lite.

## Status

- Draft — đang thảo luận.
- Accepted — đã chốt, đang implement.
- Superseded — thay bằng ADR khác.

## List

- [ADR-001](001-single-pos-per-outlet.md) Single POS per outlet
- [ADR-002](002-pwa-over-native.md) PWA Windows desktop over native
- [ADR-003](003-outbox-pattern-central.md) Transactional outbox central
- [ADR-004](004-snowflake-worker-per-device.md) Snowflake worker-id per device
- [ADR-005](005-cash-only-offline.md) Cash only offline payments
- [ADR-006](006-idempotency-reuse.md) Reuse idempotency guard
- [ADR-007](007-partition-monthly-pg_partman.md) Monthly partition via pg_partman
- [ADR-008](008-allow-negative-balance.md) Allow negative stock, flag oversell
- [ADR-009](009-retention-5-year-archive.md) 5-year sale retention + S3 archive
