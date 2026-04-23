-- Partition audit_log by created_at (monthly).
-- Simpler than sales/inventory: no child FKs, append-only semantics.

BEGIN;

-- ─── 1. Rename legacy ─────────────────────────────────────────────────────────

ALTER TABLE core.audit_log RENAME TO audit_log_legacy;

-- ─── 2. Create partitioned audit_log ─────────────────────────────────────────

CREATE TABLE core.audit_log (
  id             BIGINT        NOT NULL,
  actor_user_id  BIGINT        REFERENCES core.app_user(id) ON DELETE SET NULL,
  action         audit_action_enum NOT NULL,
  entity_name    VARCHAR(100)  NOT NULL,
  entity_id      VARCHAR(100)  NOT NULL,
  reason         TEXT,
  old_data       JSONB,
  new_data       JSONB,
  ip_address     INET,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Past partitions
CREATE TABLE core.audit_log_2025_01 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE core.audit_log_2025_02 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE core.audit_log_2025_03 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE core.audit_log_2025_04 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE core.audit_log_2025_05 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE core.audit_log_2025_06 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE core.audit_log_2025_07 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE core.audit_log_2025_08 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE core.audit_log_2025_09 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE core.audit_log_2025_10 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE core.audit_log_2025_11 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE core.audit_log_2025_12 PARTITION OF core.audit_log
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
-- Current + future
CREATE TABLE core.audit_log_2026_01 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE core.audit_log_2026_02 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE core.audit_log_2026_03 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE core.audit_log_2026_04 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE core.audit_log_2026_05 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE core.audit_log_2026_06 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE core.audit_log_2026_07 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE core.audit_log_2026_08 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE core.audit_log_2026_09 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE core.audit_log_2026_10 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE core.audit_log_2026_11 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE core.audit_log_2026_12 PARTITION OF core.audit_log
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE core.audit_log_default PARTITION OF core.audit_log DEFAULT;

-- Indexes
CREATE INDEX idx_audit_log_actor_user_id ON core.audit_log(actor_user_id);
CREATE INDEX idx_audit_log_action         ON core.audit_log(action);
CREATE INDEX idx_audit_log_entity_name    ON core.audit_log(entity_name);
CREATE INDEX idx_audit_log_entity_lookup  ON core.audit_log(entity_name, entity_id);
CREATE INDEX idx_audit_log_created_at     ON core.audit_log(created_at);

-- ─── 3. Backfill ─────────────────────────────────────────────────────────────

INSERT INTO core.audit_log
SELECT id, actor_user_id, action, entity_name, entity_id, reason,
       old_data, new_data, ip_address, user_agent, created_at
FROM core.audit_log_legacy;

-- ─── 4. Drop legacy (uncomment after row-count verification) ─────────────────
-- SELECT COUNT(*) FROM core.audit_log;
-- SELECT COUNT(*) FROM core.audit_log_legacy;
DROP TABLE core.audit_log_legacy;

COMMIT;
