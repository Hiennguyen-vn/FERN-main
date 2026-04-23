# ADR-001: Single POS Per Outlet

**Status**: Accepted
**Date**: 2026-04-23

## Context

FERN coffee chain (Highlands-style) pilot. Mỗi outlet nhỏ, 1 quầy thu ngân. Offline-first bắt buộc.

Multi-terminal per outlet đòi hỏi edge server (mini-PC + Postgres local + LAN sync) — tăng hardware + ops đáng kể. Toast pattern nhưng overkill cho 1 quầy.

## Decision

**Scope MVP: 1 POS hoạt động / outlet / thời điểm.**

- Tab thứ 2 trong cùng browser → BroadcastChannel lock → read-only mode.
- Cùng user mở 2 browser khác (Chrome + Edge) → detect fingerprint mismatch → yêu cầu re-provision.
- Không edge server, không LAN sync giữa terminal.

## Consequences

### Positive

- Kiến trúc đơn giản: 2-tier browser ↔ central.
- Không cần hardware mini-PC per outlet.
- Không cần maintain edge stack Docker.
- Snowflake worker-id = 1 per outlet đủ.
- Không cần CRDT merge intra-outlet.
- Development cost thấp.

### Negative

- Không share catalog cache giữa multi-terminal cùng outlet.
- Mất browser IndexedDB = mất pending orders (mitigation: backup outbox lên server ngay khi online).
- Không dùng được cho outlet lớn (>1 thu ngân).

### Future

Khi cần multi-terminal (tên F&B full hoặc outlet lớn), migrate sang edge server pattern (Toast mode 2) — xem Future Phase VI.

## Alternatives Considered

1. **Toast-style local hub**: mini-PC làm hub LAN. Loại vì overkill cho 1 quầy + ops cost cao.
2. **Multi-terminal với central-only sync**: 2 POS cùng push cloud. Loại vì race condition khi mất mạng — không có LAN arbiter.
3. **Native app per terminal**: Capacitor wrap PWA. Defer — chỉ làm khi iOS/Android cần.
