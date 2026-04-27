-- Outbox writes use created_at = NOW(). V19 bootstrapped only 2026-05..2026-07,
-- which leaves April 2026 and the rest of 2026 without partitions.
-- Keep this explicit until pg_partman takes over from the 2027 start partition.

CREATE TABLE IF NOT EXISTS core.outbox_event_2026_04 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS core.outbox_event_2026_08 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS core.outbox_event_2026_09 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS core.outbox_event_2026_10 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS core.outbox_event_2026_11 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS core.outbox_event_2026_12 PARTITION OF core.outbox_event
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
