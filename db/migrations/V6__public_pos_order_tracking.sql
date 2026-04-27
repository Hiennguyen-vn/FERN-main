ALTER TABLE core.sale_record
  ADD COLUMN IF NOT EXISTS ordering_table_id BIGINT REFERENCES core.ordering_table(id),
  ADD COLUMN IF NOT EXISTS public_token TEXT;

CREATE INDEX IF NOT EXISTS idx_sale_record_ordering_table_id
  ON core.sale_record(ordering_table_id)
  WHERE ordering_table_id IS NOT NULL;
