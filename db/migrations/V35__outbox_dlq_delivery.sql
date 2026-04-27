ALTER TABLE core.outbox_event
  ADD COLUMN IF NOT EXISTS dlq_status TEXT NOT NULL DEFAULT 'NOT_QUEUED'
    CHECK (dlq_status IN ('NOT_QUEUED', 'PENDING', 'PUBLISHED')),
  ADD COLUMN IF NOT EXISTS dlq_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dlq_retry_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dlq_attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dlq_last_error TEXT;

UPDATE core.outbox_event
SET dlq_status = 'PENDING',
    dlq_retry_after = NULL,
    dlq_published_at = NULL
WHERE status = 'FAILED'
  AND dlq_status <> 'PUBLISHED';

CREATE INDEX IF NOT EXISTS ix_outbox_dlq_pending
  ON core.outbox_event (dlq_status, created_at)
  WHERE status = 'FAILED' AND dlq_status = 'PENDING';

DROP VIEW IF EXISTS core.outbox_dlq;
CREATE VIEW core.outbox_dlq AS
SELECT
  oe.id,
  oe.aggregate_type,
  oe.aggregate_id,
  oe.topic,
  oe.event_key,
  oe.payload,
  oe.attempt_count,
  oe.last_error,
  oe.retry_after,
  oe.created_at,
  oe.dlq_status,
  oe.dlq_published_at,
  oe.dlq_retry_after,
  oe.dlq_attempt_count,
  oe.dlq_last_error,
  pe.outlet_id,
  pe.device_id,
  pe.event_type,
  pe.client_occurred_at
FROM core.outbox_event oe
LEFT JOIN LATERAL (
  SELECT outlet_id, device_id, event_type, client_occurred_at
  FROM core.processed_events pe2
  WHERE pe2.resource_id = oe.aggregate_id
  ORDER BY pe2.server_received_at DESC
  LIMIT 1
) pe ON true
WHERE oe.status = 'FAILED';

CREATE OR REPLACE FUNCTION core.outbox_replay(
  p_event_id   BIGINT,
  p_created_at TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
  UPDATE core.outbox_event
  SET status           = 'PENDING',
      attempt_count    = 0,
      retry_after      = NULL,
      last_error       = NULL,
      dlq_status       = 'NOT_QUEUED',
      dlq_published_at = NULL,
      dlq_retry_after  = NULL,
      dlq_attempt_count = 0,
      dlq_last_error   = NULL
  WHERE id         = p_event_id
    AND created_at = p_created_at
    AND status     = 'FAILED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event id=% created_at=% not found or not in FAILED state',
      p_event_id, p_created_at;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core.outbox_replay_device(p_device_id BIGINT)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE core.outbox_event oe
  SET status            = 'PENDING',
      attempt_count     = 0,
      retry_after       = NULL,
      last_error        = NULL,
      dlq_status        = 'NOT_QUEUED',
      dlq_published_at  = NULL,
      dlq_retry_after   = NULL,
      dlq_attempt_count = 0,
      dlq_last_error    = NULL
  FROM (
    SELECT DISTINCT resource_id
    FROM core.processed_events
    WHERE device_id = p_device_id
  ) pe
  WHERE oe.aggregate_id = pe.resource_id
    AND oe.status = 'FAILED';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core.outbox_dlq_requeue(
  p_event_id   BIGINT,
  p_created_at TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
  UPDATE core.outbox_event
  SET dlq_status        = 'PENDING',
      dlq_published_at  = NULL,
      dlq_retry_after   = NULL,
      dlq_attempt_count = 0,
      dlq_last_error    = NULL
  WHERE id         = p_event_id
    AND created_at = p_created_at
    AND status     = 'FAILED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAILED event id=% created_at=% not found',
      p_event_id, p_created_at;
  END IF;
END;
$$ LANGUAGE plpgsql;
