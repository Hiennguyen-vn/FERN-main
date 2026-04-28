ALTER TABLE core.inventory_transaction
  DROP CONSTRAINT IF EXISTS chk_inventory_txn_sign;

ALTER TABLE core.inventory_transaction
  ADD CONSTRAINT chk_inventory_txn_sign CHECK (
    CASE
      WHEN txn_type IN ('purchase_in','stock_adjustment_in','manufacture_in','sale_reversal','stock_in_simple')
        THEN qty_change > 0
      WHEN txn_type IN ('sale_usage','waste_out','stock_adjustment_out','manufacture_out')
        THEN qty_change < 0
    END
  );

CREATE TABLE IF NOT EXISTS core.offline_inventory_movement (
  id                         BIGINT PRIMARY KEY,
  source_event_id            TEXT NOT NULL UNIQUE,
  source_idempotency_key     TEXT,
  movement_type              TEXT NOT NULL CHECK (movement_type IN ('STOCK_IN_SIMPLE')),
  outlet_id                  BIGINT NOT NULL,
  device_id                  BIGINT,
  pos_session_id             BIGINT,
  terminal_id                TEXT,
  actor_user_id              BIGINT,
  actor_username             TEXT,
  item_id                    BIGINT NOT NULL,
  sku                        TEXT,
  quantity                   NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit                       TEXT,
  reason                     TEXT NOT NULL,
  note                       TEXT NOT NULL,
  business_date              DATE,
  created_at_device          TIMESTAMPTZ,
  source                     TEXT NOT NULL DEFAULT 'POS_OFFLINE',
  needs_review               BOOLEAN NOT NULL DEFAULT TRUE,
  review_status              TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (review_status IN ('PENDING','APPROVED','REJECTED')),
  sync_status                TEXT NOT NULL DEFAULT 'PROCESSING'
    CHECK (sync_status IN ('PROCESSING','APPLIED','REJECTED')),
  rejected_reason            TEXT,
  inventory_transaction_id   BIGINT,
  inventory_txn_time         TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_offline_inventory_movement_inventory_txn
    FOREIGN KEY (inventory_transaction_id, inventory_txn_time)
    REFERENCES core.inventory_transaction(id, txn_time)
);

CREATE INDEX IF NOT EXISTS idx_offline_inventory_movement_outlet_status
  ON core.offline_inventory_movement(outlet_id, sync_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offline_inventory_movement_item
  ON core.offline_inventory_movement(outlet_id, item_id, created_at_device DESC);

CREATE TRIGGER trg_offline_inventory_movement_updated_at
BEFORE UPDATE ON core.offline_inventory_movement
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

ALTER TABLE core.offline_inventory_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.offline_inventory_movement FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_offline_inventory_movement_outlet ON core.offline_inventory_movement;
CREATE POLICY p_offline_inventory_movement_outlet ON core.offline_inventory_movement
  USING (core.fn_outlet_allowed(outlet_id))
  WITH CHECK (core.fn_outlet_allowed(outlet_id));
