ALTER TABLE core.outbox_event
  DROP CONSTRAINT IF EXISTS outbox_event_dlq_status_check;
ALTER TABLE core.outbox_event
  ADD CONSTRAINT outbox_event_dlq_status_check
  CHECK (dlq_status IN ('NOT_QUEUED', 'PENDING', 'PROCESSING', 'PUBLISHED'));

ALTER TABLE core.outbox_event
  ADD COLUMN IF NOT EXISTS dlq_processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dlq_processing_owner TEXT;

UPDATE core.outbox_event
SET dlq_status = 'PENDING',
    dlq_processing_started_at = NULL,
    dlq_processing_owner = NULL
WHERE dlq_status = 'PROCESSING'
  AND status = 'FAILED';

CREATE INDEX IF NOT EXISTS ix_outbox_dlq_processing_reclaim
  ON core.outbox_event (dlq_status, dlq_processing_started_at)
  WHERE status = 'FAILED' AND dlq_status = 'PROCESSING';
