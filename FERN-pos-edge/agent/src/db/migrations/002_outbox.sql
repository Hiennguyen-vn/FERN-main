-- Local outbox — events pending push to FERN central via /sync/push.

CREATE TABLE IF NOT EXISTS outbox_event (
  id               BIGINT PRIMARY KEY,
  event_type       TEXT NOT NULL,
  idempotency_key  TEXT UNIQUE NOT NULL,
  aggregate_type   TEXT NOT NULL,
  aggregate_id     BIGINT NOT NULL,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SYNCING', 'ACKED', 'FAILED')),
  attempt_count    INT NOT NULL DEFAULT 0,
  retry_after      TIMESTAMPTZ,
  last_error       TEXT,
  client_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_outbox_pending
  ON outbox_event(retry_after NULLS FIRST, created_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS ix_outbox_aggregate
  ON outbox_event(aggregate_type, aggregate_id);
