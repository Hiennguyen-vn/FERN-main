ALTER TABLE core.sync_outbox
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE core.sync_outbox
  DROP CONSTRAINT IF EXISTS sync_outbox_status_check;

ALTER TABLE core.sync_outbox
  ADD CONSTRAINT sync_outbox_status_check
  CHECK (status IN ('PENDING','IN_FLIGHT','FAILED','SENT'));

DROP INDEX IF EXISTS idx_sync_outbox_pending;

CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
  ON core.sync_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('PENDING','FAILED');
