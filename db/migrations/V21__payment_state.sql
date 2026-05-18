-- Payment state machine for offline reconciliation.
-- New columns track offline capture, reconciliation, and the originating device.
ALTER TABLE core.payment
  ADD COLUMN IF NOT EXISTS state            TEXT NOT NULL DEFAULT 'COMPLETED'
    CHECK (state IN ('PENDING_OFFLINE','QUEUED','COMPLETED','RECONCILED','FAILED')),
  ADD COLUMN IF NOT EXISTS offline_captured_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS device_id            BIGINT;
-- FK to device_registry added in V27 after that table is created

-- Backfill: existing payments are already completed
UPDATE core.payment SET state = 'COMPLETED' WHERE state IS NULL OR state = 'COMPLETED';
