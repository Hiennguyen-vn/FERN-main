# ADR-0003: Stock reservation rollout (W0.3)

## Status
Skeleton merged 2026-05-02. Production cutover pending.

## Context
Pre-W0.3, sales-service wrote `core.stock_balance` directly during order create AND inventory-service consumer also deducted on `pos.sale.approved` ⇒ dual-write window during retry/reclaim could double-deduct stock.

## Decision
Reservation pattern:
1. Sales-service POSTs to inventory `/api/v1/inventory/reservations` after order create — appends `core.stock_reservation`.
2. `pos.sale.approved` consumer in inventory-service confirms reservation (terminal state) and applies movement.
3. `pos.sale.cancelled` consumer releases reservation, no movement.
4. Available qty = `stock_balance.qty_on_hand − sum(active reservations.qty)`.

## Rollout
Feature flag `sales.reservation.enabled` (default `false`). Rollout tiers:
1. 1 outlet for 24h → diff `scripts/inventory-reservation-diff.sql` returns 0 variance.
2. 10 outlets for 24h → same assertion.
3. Region for 7 days.
4. Global.

Post-cutover (4 weeks): delete legacy stock_balance write path from sales-service, set flag default `true`, remove flag.

## Sweep
`StockReservationService.sweepExpired` runs every 60s (configurable via `fern.inventory.reservation-sweep-ms`). Releases reservations with:
- `expires_at IS NOT NULL AND expires_at <= NOW()`, or
- `reserved_at < NOW() - INTERVAL '24 hours'` (catch-all for stuck sales never approved/cancelled)

ShedLock prevents double-sweep across replicas.

## Risk register
- **W0.3 ships skeleton only**: backend + edge-side flag wiring done, schema (`V56__stock_reservation.sql`) pre-existed. Cutover alone, without W0.1 stable eventId (already done) + W0.2 unlocked reads (done), would risk double-deduct. All 3 dependencies merged.
- **Diff job**: not yet implemented (`scripts/inventory-reservation-diff.sql`); blocks tier-1 cutover assertion. Tracked separately.
- **Legacy write removal**: hard-coded in `SalesRepository.loadStockByItem` lockRows path; remove only after metric `sales_legacy_stock_write_total` = 0 for 24h on canary outlets.

## Alternatives rejected
- **Sales as inventory writer**: violates single-writer doctrine.
- **Distributed lock per item**: hot-key contention at hundreds-of-outlets scale.
- **Saga with compensating tx**: latency unacceptable for sub-second order create.
