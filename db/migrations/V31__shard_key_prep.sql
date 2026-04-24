-- Shard-key preparation: denorm outlet_id on sale_item and payment.
-- sale_record already has outlet_id (source of truth).
-- sale_item and payment gained outlet_id in V24 (partitioned schema).
-- This migration ensures the column + index exist if V24 was applied on a
-- pre-partitioned DB (no-op if already present via V24).

-- sale_item: outlet_id already added in V24 partitioned DDL.
-- Backfill any NULLs (pre-V24 rows via legacy backfill might have missed it).
UPDATE core.sale_item si
SET outlet_id = sr.outlet_id
FROM core.sale_record sr
WHERE si.sale_id = sr.id
  AND si.outlet_id IS NULL;

-- Index (may already exist from V24)
CREATE INDEX IF NOT EXISTS ix_sale_item_outlet ON core.sale_item(outlet_id);

-- payment: outlet_id already added in V24 partitioned DDL.
UPDATE core.payment p
SET outlet_id = sr.outlet_id
FROM core.sale_record sr
WHERE p.sale_id = sr.id
  AND p.outlet_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_payment_outlet ON core.payment(outlet_id);

-- inventory_transaction: already has outlet_id (original schema).
CREATE INDEX IF NOT EXISTS ix_inv_txn_outlet_item
  ON core.inventory_transaction(outlet_id, item_id);
