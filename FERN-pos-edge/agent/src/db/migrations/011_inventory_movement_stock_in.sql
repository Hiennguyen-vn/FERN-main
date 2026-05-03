CREATE TABLE IF NOT EXISTS inventory_movement (
  event_id             BIGINT PRIMARY KEY,
  idempotency_key      TEXT NOT NULL UNIQUE,
  request_hash         TEXT NOT NULL,
  movement_type        TEXT NOT NULL CHECK (movement_type IN ('STOCK_IN_SIMPLE')),
  outlet_id            BIGINT NOT NULL,
  item_id              BIGINT NOT NULL REFERENCES item(id),
  quantity             NUMERIC(18, 3) NOT NULL CHECK (quantity > 0),
  unit                 TEXT NOT NULL,
  reason               TEXT NOT NULL,
  note                 TEXT NOT NULL,
  actor_user_id        BIGINT NOT NULL,
  actor_username       TEXT NOT NULL,
  device_id            BIGINT,
  pos_session_id       BIGINT REFERENCES pos_session(id),
  terminal_id          TEXT,
  register_code        TEXT,
  business_date        DATE NOT NULL,
  created_at_device    TIMESTAMPTZ NOT NULL,
  source               TEXT NOT NULL DEFAULT 'POS_OFFLINE',
  needs_review         BOOLEAN NOT NULL DEFAULT TRUE,
  sync_status          TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (sync_status IN ('PENDING', 'SYNCING', 'ACKED', 'FAILED')),
  outbox_event_id      BIGINT REFERENCES outbox_event(id),
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_inventory_movement_outlet_status
  ON inventory_movement(outlet_id, sync_status, created_at_device DESC);

CREATE INDEX IF NOT EXISTS ix_inventory_movement_item_time
  ON inventory_movement(outlet_id, item_id, created_at_device DESC);

CREATE INDEX IF NOT EXISTS ix_inventory_movement_outbox
  ON inventory_movement(outbox_event_id)
  WHERE outbox_event_id IS NOT NULL;
