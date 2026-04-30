-- V56: Stock reservation pattern (advisory layer).
-- Reservations are append-only, no FOR UPDATE on writes. They reduce read-side lock
-- contention by letting available_qty be computed as balance - sum(unsettled).
-- The hard stock deduction continues via core.inventory_transaction at approveSale time;
-- settlement job marks reservations as settled to keep the table compact.

CREATE TABLE core.stock_reservation (
  id BIGINT PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES core.outlet(id),
  item_id BIGINT NOT NULL REFERENCES core.item(id),
  qty NUMERIC(18,4) NOT NULL CHECK (qty > 0),
  sale_id BIGINT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'sale',
  CONSTRAINT chk_settled_after_reserved
    CHECK (settled_at IS NULL OR settled_at >= reserved_at)
);

CREATE INDEX idx_stock_reservation_unsettled
  ON core.stock_reservation(location_id, item_id)
  WHERE settled_at IS NULL;

CREATE INDEX idx_stock_reservation_sale
  ON core.stock_reservation(sale_id)
  WHERE sale_id IS NOT NULL;

CREATE INDEX idx_stock_reservation_expiry
  ON core.stock_reservation(expires_at)
  WHERE settled_at IS NULL AND expires_at IS NOT NULL;

CREATE OR REPLACE VIEW core.stock_available AS
SELECT
  b.location_id,
  b.item_id,
  b.qty_on_hand                                    AS balance_qty,
  COALESCE(r.reserved_qty, 0)                      AS reserved_qty,
  b.qty_on_hand - COALESCE(r.reserved_qty, 0)      AS available_qty,
  b.unit_cost,
  b.updated_at
FROM core.stock_balance b
LEFT JOIN (
  SELECT location_id, item_id, SUM(qty) AS reserved_qty
    FROM core.stock_reservation
   WHERE settled_at IS NULL
     AND (expires_at IS NULL OR expires_at > NOW())
   GROUP BY 1, 2
) r ON r.location_id = b.location_id AND r.item_id = b.item_id;

COMMENT ON TABLE core.stock_reservation IS
  'Append-only advisory reservations. Hard deduction still done via inventory_transaction.';
COMMENT ON VIEW core.stock_available IS
  'Real-time available qty = balance - sum(unsettled reservations). Avoids row-level locks for reads.';
