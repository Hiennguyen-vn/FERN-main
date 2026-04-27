ALTER TABLE core.pos_session
  ADD COLUMN IF NOT EXISTS device_id BIGINT REFERENCES core.device_registry(id),
  ADD COLUMN IF NOT EXISTS register_code TEXT,
  ADD COLUMN IF NOT EXISTS opened_by_username TEXT;

UPDATE core.pos_session
SET register_code = COALESCE(register_code, session_code),
    opened_by_username = COALESCE(opened_by_username, 'unknown')
WHERE register_code IS NULL
   OR opened_by_username IS NULL;

CREATE INDEX IF NOT EXISTS idx_pos_session_outlet_device_register_status
  ON core.pos_session(outlet_id, device_id, register_code, status);

ALTER TABLE core.sale_item
  ADD COLUMN IF NOT EXISTS variant_id BIGINT REFERENCES core.product_variant(id),
  ADD COLUMN IF NOT EXISTS variant_name TEXT;

CREATE TABLE IF NOT EXISTS core.sale_item_modifier (
  sale_id BIGINT NOT NULL,
  sale_created_at TIMESTAMPTZ NOT NULL,
  product_id BIGINT NOT NULL,
  modifier_option_id BIGINT NOT NULL REFERENCES core.modifier_option(id),
  group_code TEXT,
  group_name TEXT,
  option_code TEXT,
  option_name TEXT,
  price_add_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sale_id, sale_created_at, product_id, modifier_option_id),
  CONSTRAINT fk_sale_item_modifier_sale_item
    FOREIGN KEY (sale_id, sale_created_at, product_id)
    REFERENCES core.sale_item(sale_id, sale_created_at, product_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sale_item_modifier_sale
  ON core.sale_item_modifier(sale_id, sale_created_at);
