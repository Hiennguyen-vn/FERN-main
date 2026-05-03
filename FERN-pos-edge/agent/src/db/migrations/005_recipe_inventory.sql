CREATE TABLE IF NOT EXISTS recipe (
  product_id       BIGINT PRIMARY KEY,
  version          TEXT NOT NULL,
  yield_qty        NUMERIC(18, 6) NOT NULL,
  yield_uom_code   TEXT NOT NULL,
  status           TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipe_component (
  product_id          BIGINT NOT NULL REFERENCES recipe(product_id) ON DELETE CASCADE,
  item_id             BIGINT NOT NULL,
  item_code           TEXT,
  item_name           TEXT,
  component_qty       NUMERIC(18, 6) NOT NULL,
  yield_qty           NUMERIC(18, 6) NOT NULL,
  component_uom_code  TEXT NOT NULL,
  item_base_uom_code  TEXT NOT NULL,
  conversion_factor   NUMERIC(18, 8) NOT NULL DEFAULT 1,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, item_id)
);
CREATE INDEX IF NOT EXISTS ix_recipe_component_product ON recipe_component(product_id);

CREATE TABLE IF NOT EXISTS sale_inventory_reservation (
  sale_id         BIGINT NOT NULL REFERENCES sale_record(id) ON DELETE CASCADE,
  item_id         BIGINT NOT NULL,
  reserved_qty    NUMERIC(18, 6) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sale_id, item_id)
);
CREATE INDEX IF NOT EXISTS ix_sale_inventory_reservation_item
  ON sale_inventory_reservation(item_id);
