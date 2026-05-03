-- Add category_name to product for display
ALTER TABLE product ADD COLUMN IF NOT EXISTS category_name text;

-- Add columns missing from initial payment schema
ALTER TABLE payment ADD COLUMN IF NOT EXISTS device_id            BIGINT;
ALTER TABLE payment ADD COLUMN IF NOT EXISTS captured_by_user_id  BIGINT;
ALTER TABLE payment ADD COLUMN IF NOT EXISTS captured_by_username TEXT;
ALTER TABLE payment ADD COLUMN IF NOT EXISTS offline_captured_at  TIMESTAMPTZ;
ALTER TABLE payment ADD COLUMN IF NOT EXISTS reconciled_at        TIMESTAMPTZ;
ALTER TABLE payment ADD COLUMN IF NOT EXISTS transaction_ref      TEXT;
