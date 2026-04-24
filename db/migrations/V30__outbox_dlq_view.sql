-- DLQ view: FAILED outbox events with device/outlet context from processed_events.
-- Admin replay function: reset FAILED → PENDING for manual retry.

CREATE OR REPLACE VIEW core.outbox_dlq AS
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

-- Admin replay: reset single FAILED event → PENDING
CREATE OR REPLACE FUNCTION core.outbox_replay(
  p_event_id   BIGINT,
  p_created_at TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
  UPDATE core.outbox_event
  SET status        = 'PENDING',
      attempt_count = 0,
      retry_after   = NULL,
      last_error    = NULL
  WHERE id         = p_event_id
    AND created_at = p_created_at
    AND status     = 'FAILED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event id=% created_at=% not found or not in FAILED state',
      p_event_id, p_created_at;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Admin replay all FAILED events for a device
CREATE OR REPLACE FUNCTION core.outbox_replay_device(p_device_id BIGINT)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  -- Identify aggregate_ids belonging to device via processed_events
  UPDATE core.outbox_event oe
  SET status        = 'PENDING',
      attempt_count = 0,
      retry_after   = NULL,
      last_error    = NULL
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
