-- Audit stream for processed sync events: 90-day hot + S3 archive.
-- Append-only. Partitioned monthly by server_received_at.

CREATE TABLE core.processed_events (
  id                   BIGINT        NOT NULL,
  idempotency_key      TEXT          NOT NULL,
  device_id            BIGINT        NOT NULL,
  outlet_id            BIGINT        NOT NULL,
  event_type           TEXT          NOT NULL,
  payload_hash         CHAR(64)      NOT NULL,   -- SHA-256 for fuzzy dedup
  result_status        TEXT          NOT NULL
    CHECK (result_status IN ('SUCCESS','REJECTED','DLQ')),
  resource_id          BIGINT,                   -- sale_id, payment_id, etc.
  rejected_reason      TEXT,
  client_occurred_at   TIMESTAMPTZ,
  server_received_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, server_received_at),
  UNIQUE (idempotency_key, server_received_at)
) PARTITION BY RANGE (server_received_at);

-- Bootstrap partitions — current month + 12 future
CREATE TABLE core.processed_events_2026_04 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE core.processed_events_2026_05 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE core.processed_events_2026_06 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE core.processed_events_2026_07 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE core.processed_events_2026_08 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE core.processed_events_2026_09 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE core.processed_events_2026_10 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE core.processed_events_2026_11 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE core.processed_events_2026_12 PARTITION OF core.processed_events
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE core.processed_events_2027_01 PARTITION OF core.processed_events
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE core.processed_events_2027_02 PARTITION OF core.processed_events
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE core.processed_events_2027_03 PARTITION OF core.processed_events
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE core.processed_events_2027_04 PARTITION OF core.processed_events
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE core.processed_events_default PARTITION OF core.processed_events DEFAULT;

CREATE INDEX ix_processed_events_device
  ON core.processed_events(device_id, server_received_at DESC);
CREATE INDEX ix_processed_events_outlet_type
  ON core.processed_events(outlet_id, event_type, server_received_at DESC);
CREATE INDEX ix_processed_events_dlq
  ON core.processed_events(outlet_id, server_received_at)
  WHERE result_status = 'DLQ';

-- pg_partman auto-management: 90-day retention, keep table for S3 archive
SELECT partman.create_parent(
  p_parent_table   => 'core.processed_events',
  p_control        => 'server_received_at',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 1,
  p_start_partition => '2027-05-01',
  p_default_table  => false
);

UPDATE partman.part_config SET
  retention                = '90 days',
  retention_keep_table     = true,
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.processed_events';
