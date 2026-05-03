ALTER TABLE inventory_movement
  DROP CONSTRAINT IF EXISTS inventory_movement_movement_type_check;

ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_movement_type_check
    CHECK (movement_type IN ('STOCK_IN_SIMPLE', 'WASTE'));

ALTER TABLE inventory_movement
  DROP CONSTRAINT IF EXISTS inventory_movement_sync_status_check;

ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_sync_status_check
    CHECK (sync_status IN ('PENDING', 'SYNCING', 'ACKED', 'FAILED', 'REJECTED'));

CREATE INDEX IF NOT EXISTS ix_inventory_movement_type_status
  ON inventory_movement(movement_type, sync_status, created_at_device DESC);
