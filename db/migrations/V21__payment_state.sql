-- Payment state machine for offline POS reconciliation.
-- New columns track offline capture, reconciliation, and the originating device.
ALTER TABLE core.payment
  ADD COLUMN IF NOT EXISTS state            TEXT NOT NULL DEFAULT 'COMPLETED'
    CHECK (state IN ('PENDING_OFFLINE','QUEUED','COMPLETED','RECONCILED','FAILED')),
  ADD COLUMN IF NOT EXISTS offline_captured_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS device_id            BIGINT
    REFERENCES core.device_registry(id);

-- Backfill: existing payments are already completed
UPDATE core.payment SET state = 'COMPLETED' WHERE state IS NULL OR state = 'COMPLETED';
