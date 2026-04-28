-- V24 rebuilt sale_record as a partitioned table but did not carry forward the
-- public ordering columns introduced by V6. Restore them on the partitioned parent
-- so QR/public orders can be inserted after all migrations are applied.

ALTER TABLE core.sale_record
  ADD COLUMN IF NOT EXISTS ordering_table_id BIGINT REFERENCES core.ordering_table(id),
  ADD COLUMN IF NOT EXISTS public_token TEXT;

CREATE INDEX IF NOT EXISTS idx_sale_record_ordering_table_id
  ON core.sale_record(ordering_table_id)
  WHERE ordering_table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sale_record_public_token
  ON core.sale_record(public_token)
  WHERE public_token IS NOT NULL;
