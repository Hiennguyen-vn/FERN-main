-- V54: Legacy price flag for offline sync price drift detection.
-- Edge POS may submit sales with stale unit_price after long offline periods.
-- Server accepts the sale but flags the drift for ops review.

ALTER TABLE core.sale_item
  ADD COLUMN legacy_price BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN current_price_at_sync NUMERIC(18,2) NULL,
  ADD COLUMN price_drift_amount NUMERIC(18,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN current_price_at_sync IS NULL THEN NULL
        ELSE current_price_at_sync - unit_price
      END
    ) STORED;

CREATE INDEX idx_sale_item_legacy_price
  ON core.sale_item(sale_id)
  WHERE legacy_price = TRUE;

COMMENT ON COLUMN core.sale_item.legacy_price IS
  'TRUE when edge-submitted unit_price differs from current product price at sync time.';
COMMENT ON COLUMN core.sale_item.current_price_at_sync IS
  'Resolved current price at the moment the server accepted the sale.';
COMMENT ON COLUMN core.sale_item.price_drift_amount IS
  'current_price_at_sync - unit_price. Positive = customer paid less than current price.';
