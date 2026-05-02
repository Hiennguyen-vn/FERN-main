-- inventory-reservation-diff.sql
-- Asserts ledger ↔ stock_balance ↔ active reservations consistency.
-- Run during W0.3 reservation rollout tier-cutover; non-empty result = variance.
-- Usage:
--   psql "$PG_PRIMARY_URL" -f db/scripts/inventory-reservation-diff.sql

\echo '── 1. ledger vs stock_balance (post-trigger invariant) ────────────────'
WITH ledger AS (
  SELECT outlet_id AS location_id, item_id,
         COALESCE(SUM(qty_change), 0) AS ledger_sum
  FROM core.inventory_transaction
  GROUP BY outlet_id, item_id
)
SELECT sb.location_id,
       sb.item_id,
       sb.qty_on_hand,
       COALESCE(l.ledger_sum, 0) AS ledger_sum,
       sb.qty_on_hand - COALESCE(l.ledger_sum, 0) AS variance
FROM core.stock_balance sb
LEFT JOIN ledger l ON l.location_id = sb.location_id AND l.item_id = sb.item_id
WHERE ABS(sb.qty_on_hand - COALESCE(l.ledger_sum, 0)) > 0.0001
ORDER BY ABS(sb.qty_on_hand - COALESCE(l.ledger_sum, 0)) DESC
LIMIT 50;

\echo '── 2. orphan reservations (terminal state >24h not settled) ───────────'
SELECT id, location_id, item_id, sale_id, qty,
       reserved_at, expires_at,
       NOW() - reserved_at AS age
FROM core.stock_reservation
WHERE settled_at IS NULL
  AND reserved_at < NOW() - INTERVAL '24 hours'
ORDER BY reserved_at
LIMIT 50;

\echo '── 3. reservation-vs-sale alignment (settled reservations should match) ──'
WITH active_res AS (
  SELECT location_id, item_id,
         COALESCE(SUM(qty), 0) AS reserved_qty
  FROM core.stock_reservation
  WHERE settled_at IS NULL
  GROUP BY location_id, item_id
)
SELECT sb.location_id,
       sb.item_id,
       sb.qty_on_hand,
       COALESCE(ar.reserved_qty, 0) AS active_reserved,
       sb.qty_on_hand - COALESCE(ar.reserved_qty, 0) AS available_qty
FROM core.stock_balance sb
LEFT JOIN active_res ar ON ar.location_id = sb.location_id AND ar.item_id = sb.item_id
WHERE COALESCE(ar.reserved_qty, 0) > sb.qty_on_hand  -- reserved more than on hand
ORDER BY (COALESCE(ar.reserved_qty, 0) - sb.qty_on_hand) DESC
LIMIT 50;

\echo '── done. Empty result sets = OK to advance rollout tier. ──────────────'
