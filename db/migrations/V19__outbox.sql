-- Transactional outbox: append-only, partitioned monthly by created_at
-- Relay polls PENDING rows and publishes to Kafka via SKIP LOCKED
CREATE TABLE core.outbox_event (
  id              BIGINT        NOT NULL,
  aggregate_type  TEXT          NOT NULL,
  aggregate_id    BIGINT        NOT NULL,
  topic           TEXT          NOT NULL,
  event_key       TEXT          NOT NULL,
  payload         JSONB         NOT NULL,
  headers         JSONB,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ,
  retry_after     TIMESTAMPTZ,
  status          TEXT          NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PUBLISHED','FAILED')),
  attempt_count   INT           NOT NULL DEFAULT 0,
  last_error      TEXT,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Bootstrap 3 monthly partitions (adjust years as needed)
CREATE TABLE core.outbox_event_2026_05 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE core.outbox_event_2026_06 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE core.outbox_event_2026_07 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Relay fetch index: skip backoff rows
CREATE INDEX ix_outbox_pending ON core.outbox_event (status, created_at)
  WHERE status = 'PENDING';

-- Fast lookup by aggregate for admin replay
CREATE INDEX ix_outbox_aggregate ON core.outbox_event (aggregate_type, aggregate_id, created_at DESC);
