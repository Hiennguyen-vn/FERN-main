# ADR-004: Snowflake Worker-ID Per Device

**Status**: Accepted
**Date**: 2026-04-23

## Context

POS client cần sinh ID offline cho sale_record, sale_item, payment, events. Nếu server-gen → không submit được offline.

Hiện FERN `SnowflakeIdGenerator` hash hostname → risk collision nếu 2 máy trùng hostname hoặc gen concurrent.

## Decision

**Allocate worker-id per device qua central registry.**

- Table `core.device_registry` với UNIQUE `worker_id` 128-1023 (896 max concurrent POS).
- Reserve 0-127 cho server-side workers.
- `POST /api/v1/devices/provision` → allocate sequential worker_id → lưu client-side IndexedDB.
- POS client snowflake: 41-bit timestamp + 10-bit worker_id + 12-bit seq.
- Server-side services nhận worker_id qua `app.snowflake.worker-id` config.

## Consequences

### Positive

- Zero collision giữa POS devices toàn hệ thống.
- Offline ID generation safe — sync lên central không đụng nhau.
- Idempotency key lookup dùng `event_id` snowflake → global unique.
- Monitor `device_registry.last_seen_at` cho health check.

### Negative

- Max 896 concurrent POS devices — đủ cho pilot + mid-scale.
- Cần re-provision nếu hostname/browser thay đổi.
- Device decommission → revoke `revoked_at` nhưng không reuse worker_id (tránh lẫn data cũ).

## Scale Beyond 896

- Extend snowflake sang 12-bit worker_id (4096 device) khi cần.
- Tách namespace worker_id per region.

## Alternatives Considered

1. **UUID client-gen**: đơn giản nhưng lose sortability. Loại vì FERN đã chọn snowflake.
2. **Worker_id = outlet_id**: risk nếu outlet_id > 1023 hoặc multi-device cùng outlet tương lai.
3. **ZooKeeper-style lease**: phức tạp, overkill.

## References

- [docs/offline-pos/05-implementation-plan.md](../05-implementation-plan.md) W2
