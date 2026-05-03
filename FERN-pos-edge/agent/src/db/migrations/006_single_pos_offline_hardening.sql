ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS allowed_outlet_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE pos_session
  ADD COLUMN IF NOT EXISTS device_id BIGINT,
  ADD COLUMN IF NOT EXISTS opened_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS opened_by_username TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT;

INSERT INTO device_meta (key, value, updated_at)
SELECT 'device_id', jsonb_build_object('device_id', '0'), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM device_meta WHERE key = 'device_id'
);

UPDATE pos_session
SET device_id = COALESCE(
      device_id,
      NULLIF((SELECT value->>'device_id' FROM device_meta WHERE key = 'device_id' LIMIT 1), '')::bigint,
      0
    ),
    opened_by_user_id = COALESCE(opened_by_user_id, manager_id),
    opened_by_username = COALESCE(opened_by_username, 'unknown')
WHERE device_id IS NULL
   OR opened_by_user_id IS NULL
   OR opened_by_username IS NULL;

ALTER TABLE pos_session
  ALTER COLUMN device_id SET NOT NULL,
  ALTER COLUMN opened_by_user_id SET NOT NULL,
  ALTER COLUMN opened_by_username SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_pos_session_outlet_device_status
  ON pos_session(outlet_id, device_id, status);

ALTER TABLE sale_record
  ADD COLUMN IF NOT EXISTS cashier_username TEXT;

UPDATE sale_record
SET cashier_username = COALESCE(cashier_username, 'unknown')
WHERE cashier_username IS NULL;

ALTER TABLE sale_record
  ALTER COLUMN cashier_username SET NOT NULL;

ALTER TABLE sale_item
  ADD COLUMN IF NOT EXISTS variant_id BIGINT,
  ADD COLUMN IF NOT EXISTS variant_name TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT;

CREATE TABLE IF NOT EXISTS sale_item_modifier (
  sale_item_id       BIGINT NOT NULL REFERENCES sale_item(id) ON DELETE CASCADE,
  modifier_option_id BIGINT NOT NULL,
  group_code         TEXT,
  group_name         TEXT,
  option_code        TEXT,
  option_name        TEXT,
  price_add_cents    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (sale_item_id, modifier_option_id)
);

ALTER TABLE payment
  ADD COLUMN IF NOT EXISTS device_id BIGINT,
  ADD COLUMN IF NOT EXISTS captured_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS captured_by_username TEXT;

UPDATE payment
SET state = CASE
      WHEN state = 'COMPLETED' THEN 'RECONCILED'
      ELSE state
    END,
    device_id = COALESCE(
      device_id,
      NULLIF((SELECT value->>'device_id' FROM device_meta WHERE key = 'device_id' LIMIT 1), '')::bigint,
      0
    ),
    captured_by_user_id = COALESCE(captured_by_user_id, 0),
    captured_by_username = COALESCE(captured_by_username, 'unknown')
WHERE device_id IS NULL
   OR captured_by_user_id IS NULL
   OR captured_by_username IS NULL
   OR state = 'COMPLETED';

ALTER TABLE payment
  ALTER COLUMN device_id SET NOT NULL,
  ALTER COLUMN captured_by_user_id SET NOT NULL,
  ALTER COLUMN captured_by_username SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_payment_sale_id'
  ) THEN
    ALTER TABLE payment
      ADD CONSTRAINT uq_payment_sale_id UNIQUE (sale_id);
  END IF;
END $$;

ALTER TABLE outbox_event
  ADD COLUMN IF NOT EXISTS sync_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_attempt_id TEXT;

CREATE INDEX IF NOT EXISTS ix_outbox_syncing_stale
  ON outbox_event(sync_started_at)
  WHERE status = 'SYNCING';

CREATE TABLE IF NOT EXISTS product_variant (
  id                   BIGINT PRIMARY KEY,
  product_id           BIGINT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  code                 TEXT NOT NULL,
  name                 TEXT NOT NULL,
  price_modifier_type  TEXT NOT NULL DEFAULT 'none',
  price_modifier_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
  display_order        INT NOT NULL DEFAULT 0,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_product_variant_product
  ON product_variant(product_id, display_order, id);

CREATE TABLE IF NOT EXISTS modifier_group (
  id              BIGINT PRIMARY KEY,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  selection_type  TEXT NOT NULL DEFAULT 'single',
  min_selections  INT NOT NULL DEFAULT 0,
  max_selections  INT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  display_order   INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modifier_option (
  id                BIGINT PRIMARY KEY,
  modifier_group_id BIGINT NOT NULL REFERENCES modifier_group(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  price_adjustment  NUMERIC(15, 2) NOT NULL DEFAULT 0,
  display_order     INT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_modifier_option_group
  ON modifier_option(modifier_group_id, display_order, id);

CREATE TABLE IF NOT EXISTS product_modifier_group (
  product_id         BIGINT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  modifier_group_id  BIGINT NOT NULL REFERENCES modifier_group(id) ON DELETE CASCADE,
  is_required        BOOLEAN NOT NULL DEFAULT FALSE,
  display_order      INT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, modifier_group_id)
);
