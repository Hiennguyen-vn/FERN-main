-- Add version column for optimistic locking on frequently-updated entities.
-- Application checks rows_affected = 0 → throw OptimisticLockException.
ALTER TABLE core.product         ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
ALTER TABLE core.item            ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
ALTER TABLE core.outlet          ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
ALTER TABLE core.app_user        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
ALTER TABLE core.role            ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
ALTER TABLE core.product_price   ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
