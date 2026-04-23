# ADR-008: Allow Negative Stock Balance, Flag Oversell

**Status**: Accepted
**Date**: 2026-04-23

## Context

Offline 12h, POS không có stock real-time. Có thể bán vượt kho. 2 options:

A. **Strict**: block sale khi stock = 0. Khi sync, server reject oversell event.
B. **Soft**: allow negative, flag báo cáo. F&B accept vì hao hụt NVL thường xuyên.

## Decision

**Option B: Allow negative, flag oversell, staff resolve sau.**

- Bỏ trigger `prevent_negative_stock_balance` hoặc chuyển sang warning log.
- Client-side stock cache + oversell modal warning TẠI thời điểm bán (không phải sau sync).
- Server accept sale kể cả stock âm, ghi flag `oversell_warning_shown = true` trong sale metadata.
- Daily report list oversell events → staff kiểm kho điều chỉnh.

## Consequences

### Positive

- Không block UX bán hàng.
- F&B friendly — NVL có hao hụt tự nhiên, stock cache không chính xác tuyệt đối.
- Staff chủ động dùng judgment — cảnh báo nhưng không chặn.

### Negative

- Có thể oversell thật sự (bán 100 phần nhưng kho chỉ còn 20).
- Mitigation: modal warning client-side, hiển thị rõ "còn X phần theo cache lúc Y".
- Staff training: hiểu warning khác từ hard error.

## Reference

- [docs/offline-pos/03-inventory-ledger-vs-snapshot.md](../03-inventory-ledger-vs-snapshot.md)
- [docs/offline-pos/06-review-response.md](../06-review-response.md) P1 Stock Snapshot
