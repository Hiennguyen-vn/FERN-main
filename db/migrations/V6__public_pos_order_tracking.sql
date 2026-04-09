ALTER TABLE core.sale_record
  ADD COLUMN ordering_table_id BIGINT REFERENCES core.ordering_table(id),
  ADD COLUMN public_token TEXT;

CREATE UNIQUE INDEX idx_sale_record_public_token
  ON core.sale_record(public_token)
  WHERE public_token IS NOT NULL;

CREATE INDEX idx_sale_record_ordering_table_id
  ON core.sale_record(ordering_table_id)
  WHERE ordering_table_id IS NOT NULL;
