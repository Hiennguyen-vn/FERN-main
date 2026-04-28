ALTER TABLE core.offline_inventory_movement
  DROP CONSTRAINT IF EXISTS offline_inventory_movement_movement_type_check;

ALTER TABLE core.offline_inventory_movement
  ADD CONSTRAINT offline_inventory_movement_movement_type_check
    CHECK (movement_type IN ('STOCK_IN_SIMPLE', 'WASTE'));
