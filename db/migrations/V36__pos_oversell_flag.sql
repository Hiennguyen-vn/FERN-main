-- S2: POS oversell flag + audit + manager override audit.
-- Edge devices may take payment offline before stock is debited centrally.
-- When sync arrives and stock is insufficient, the central server must still
-- record the sale (the customer has paid) but flag it for review.

ALTER TABLE core.sale_record
  ADD COLUMN IF NOT EXISTS oversell_flag BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_sale_record_oversell
  ON core.sale_record(outlet_id, created_at)
  WHERE oversell_flag = TRUE;

CREATE TABLE IF NOT EXISTS core.sale_oversell_line (
  id              BIGSERIAL PRIMARY KEY,
  sale_id         BIGINT NOT NULL,
  sale_created_at TIMESTAMPTZ NOT NULL,
  item_id         BIGINT NOT NULL REFERENCES core.item(id),
  product_id      BIGINT REFERENCES core.product(id),
  required_qty    NUMERIC(18,4) NOT NULL,
  available_qty   NUMERIC(18,4) NOT NULL,
  short_qty       NUMERIC(18,4) NOT NULL CHECK (short_qty > 0),
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sale_id, item_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_oversell_line_sale
  ON core.sale_oversell_line(sale_id);

CREATE TABLE IF NOT EXISTS core.manager_override_audit (
  id                BIGINT PRIMARY KEY,
  outlet_id         BIGINT NOT NULL REFERENCES core.outlet(id),
  sale_id           BIGINT,
  override_type     TEXT NOT NULL CHECK (override_type IN (
    'oversell','price_drift','discount','void','refund','other'
  )),
  manager_user_id   BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  manager_pin_hash  TEXT,
  reason            TEXT NOT NULL,
  device_id         BIGINT,
  payload           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manager_override_audit_outlet_created
  ON core.manager_override_audit(outlet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_override_audit_sale
  ON core.manager_override_audit(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manager_override_audit_type
  ON core.manager_override_audit(override_type);

-- Adjust V8 negative-stock guard: respect a per-tx GUC `fern.allow_oversell`.
-- When the sync handler detects an offline-paid sale that would drive stock
-- negative, it sets the GUC for the duration of the inventory apply, bypasses
-- the trigger, and records `oversell_flag` + `sale_oversell_line` for audit.
CREATE OR REPLACE FUNCTION core.prevent_negative_stock_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_qty   NUMERIC(18,4);
  v_effective_qty  NUMERIC(18,4);
  v_allow_oversell TEXT;
BEGIN
  v_allow_oversell := current_setting('fern.allow_oversell', TRUE);

  IF TG_OP = 'INSERT' THEN
    SELECT sb.qty_on_hand
    INTO v_existing_qty
    FROM core.stock_balance sb
    WHERE sb.location_id = NEW.location_id
      AND sb.item_id = NEW.item_id;

    v_effective_qty := COALESCE(v_existing_qty, 0) + NEW.qty_on_hand;
    IF v_effective_qty < 0 AND v_allow_oversell IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Insufficient stock for outlet % item %', NEW.location_id, NEW.item_id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.qty_on_hand < 0 AND v_allow_oversell IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Insufficient stock for outlet % item %', NEW.location_id, NEW.item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
