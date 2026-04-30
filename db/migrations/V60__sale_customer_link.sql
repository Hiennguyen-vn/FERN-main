-- V60: Link sales to loyalty customers for auto-earn / redeem.
-- Customer attached at submit/approve time; nullable for walk-in/anonymous sales.

ALTER TABLE core.sale_record
  ADD COLUMN customer_id BIGINT NULL,
  ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN points_redeemed INTEGER NOT NULL DEFAULT 0;

-- Soft FK: don't cascade-block sale on customer erasure (PDPL right-to-erasure).
-- Loyalty service treats deleted_at IS NOT NULL as anonymous on lookup.
CREATE INDEX idx_sale_record_customer ON core.sale_record(customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN core.sale_record.customer_id IS
  'Loyalty customer FK (soft). NULL = walk-in. Survives customer erasure (PDPL).';
COMMENT ON COLUMN core.sale_record.points_earned IS
  'Points credited to customer at sale-approve time. 0 if no customer or sale voided.';
COMMENT ON COLUMN core.sale_record.points_redeemed IS
  'Points debited to apply voucher discount on this sale. 0 if no redemption.';
