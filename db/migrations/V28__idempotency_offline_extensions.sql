-- Extend core.idempotency_keys for offline POS context.
-- Adds device/outlet/event columns and time-range index for partition pruning.

ALTER TABLE core.idempotency_keys
  ADD COLUMN IF NOT EXISTS device_id            BIGINT REFERENCES core.device_registry(id),
  ADD COLUMN IF NOT EXISTS outlet_id            BIGINT,
  ADD COLUMN IF NOT EXISTS event_type           TEXT,
  ADD COLUMN IF NOT EXISTS client_occurred_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS server_received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Partition-prune-friendly lookup: device + outlet + time window
CREATE INDEX IF NOT EXISTS ix_idem_device_outlet
  ON core.idempotency_keys(device_id, outlet_id, server_received_at DESC);

CREATE INDEX IF NOT EXISTS ix_idem_outlet_event_type
  ON core.idempotency_keys(outlet_id, event_type, server_received_at DESC);
