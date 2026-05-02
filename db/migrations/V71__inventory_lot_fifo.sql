-- V71: F&B inventory lot tracking with FIFO depletion + expiry alerts.
-- A lot represents a received quantity of an item with a batch code, expiry date,
-- and the unit cost at receipt. Depletion picks the lot with earliest expiry.

CREATE TABLE IF NOT EXISTS core.stock_lot (
  id              BIGINT PRIMARY KEY,
  item_id         BIGINT NOT NULL REFERENCES core.item(id),
  location_id     BIGINT NOT NULL REFERENCES core.outlet(id),
  batch_no        TEXT,
  lot_code        TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      DATE,
  qty_received    NUMERIC(18,4) NOT NULL,
  qty_remaining   NUMERIC(18,4) NOT NULL,
  unit_cost       NUMERIC(18,4) NOT NULL DEFAULT 0,
  supplier_id     BIGINT,
  goods_receipt_id BIGINT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DEPLETED','EXPIRED','RECALLED')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (qty_received > 0),
  CHECK (qty_remaining >= 0)
);

-- FIFO depletion order: status=ACTIVE, expires_at ASC nulls last, received_at ASC.
CREATE INDEX IF NOT EXISTS ix_stock_lot_fifo
  ON core.stock_lot (item_id, location_id, expires_at NULLS LAST, received_at)
  WHERE status = 'ACTIVE' AND qty_remaining > 0;

CREATE INDEX IF NOT EXISTS ix_stock_lot_expiry
  ON core.stock_lot (expires_at)
  WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_stock_lot_grn
  ON core.stock_lot (goods_receipt_id);

-- Read-only view aggregating active lots per (item, location).
CREATE OR REPLACE VIEW core.v_stock_lot_summary AS
SELECT
  item_id,
  location_id,
  COUNT(*)                                    AS lot_count,
  SUM(qty_remaining)                          AS qty_total,
  MIN(expires_at)                             AS earliest_expiry,
  COUNT(*) FILTER (WHERE expires_at <= CURRENT_DATE + INTERVAL '3 days')   AS lots_expiring_soon,
  COUNT(*) FILTER (WHERE expires_at <= CURRENT_DATE)                       AS lots_expired
FROM core.stock_lot
WHERE status = 'ACTIVE' AND qty_remaining > 0
GROUP BY item_id, location_id;

GRANT SELECT, INSERT, UPDATE, DELETE ON core.stock_lot TO fern_app;
GRANT SELECT ON core.v_stock_lot_summary TO fern_app;

-- Convenience function for FIFO depletion. Returns rows that were charged with
-- (lot_id, qty_taken, unit_cost) so the caller can record per-lot ledger movements.
CREATE OR REPLACE FUNCTION core.fn_deplete_stock_lot(
  p_item_id     BIGINT,
  p_location_id BIGINT,
  p_qty         NUMERIC
)
RETURNS TABLE (lot_id BIGINT, qty_taken NUMERIC, unit_cost NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  remaining NUMERIC := p_qty;
  rec       RECORD;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT id, qty_remaining, unit_cost
    FROM core.stock_lot
    WHERE item_id = p_item_id
      AND location_id = p_location_id
      AND status = 'ACTIVE'
      AND qty_remaining > 0
    ORDER BY expires_at NULLS LAST, received_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;

    DECLARE
      take NUMERIC := LEAST(rec.qty_remaining, remaining);
    BEGIN
      UPDATE core.stock_lot
      SET qty_remaining = qty_remaining - take,
          status = CASE WHEN qty_remaining - take = 0 THEN 'DEPLETED' ELSE status END,
          updated_at = NOW()
      WHERE id = rec.id;

      lot_id := rec.id;
      qty_taken := take;
      unit_cost := rec.unit_cost;
      RETURN NEXT;

      remaining := remaining - take;
    END;
  END LOOP;

  -- Caller should detect remaining > 0 if stock insufficient.
END;
$$;

GRANT EXECUTE ON FUNCTION core.fn_deplete_stock_lot(BIGINT, BIGINT, NUMERIC) TO fern_app;
