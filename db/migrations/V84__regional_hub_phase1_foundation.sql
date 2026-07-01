ALTER TABLE core.sync_nodes
  ADD COLUMN IF NOT EXISTS parent_node_id TEXT REFERENCES core.sync_nodes(id),
  ADD COLUMN IF NOT EXISTS managed_scope_type TEXT,
  ADD COLUMN IF NOT EXISTS managed_scope_id BIGINT,
  ADD COLUMN IF NOT EXISTS runtime_role TEXT;

ALTER TABLE core.sync_nodes
  DROP CONSTRAINT IF EXISTS ck_sync_nodes_managed_scope_type;

ALTER TABLE core.sync_nodes
  ADD CONSTRAINT ck_sync_nodes_managed_scope_type
  CHECK (
    managed_scope_type IS NULL
    OR managed_scope_type IN ('STORE', 'STORE_GROUP', 'REGION')
  );

ALTER TABLE core.sync_nodes
  DROP CONSTRAINT IF EXISTS ck_sync_nodes_runtime_role;

ALTER TABLE core.sync_nodes
  ADD CONSTRAINT ck_sync_nodes_runtime_role
  CHECK (
    runtime_role IS NULL
    OR runtime_role IN ('MASTER_CENTRAL', 'REGIONAL_HUB', 'OUTLET_EDGE')
  );

CREATE INDEX IF NOT EXISTS idx_sync_nodes_parent
  ON core.sync_nodes(parent_node_id);

ALTER TABLE core.sync_logs
  DROP CONSTRAINT IF EXISTS sync_logs_direction_check;

ALTER TABLE core.sync_logs
  ADD CONSTRAINT sync_logs_direction_check
  CHECK (
    direction IN (
      'CENTRAL_TO_STORE',
      'STORE_TO_CENTRAL',
      'CENTRAL_TO_REGION',
      'REGION_TO_CENTRAL',
      'REGION_TO_OUTLET',
      'OUTLET_TO_REGION'
    )
  );

CREATE TABLE IF NOT EXISTS core.downstream_outbox (
  id                    BIGSERIAL PRIMARY KEY,
  source_node_id        TEXT NOT NULL REFERENCES core.sync_nodes(id),
  event_type            TEXT NOT NULL,
  aggregate_type        TEXT NOT NULL,
  aggregate_id          TEXT NOT NULL,
  target_scope          TEXT NOT NULL
    CHECK (target_scope IN ('ALL_STORES', 'STORE', 'STORE_GROUP', 'NODE')),
  target_store_id       BIGINT REFERENCES core.outlet(id),
  target_store_group_id BIGINT,
  target_node_id        TEXT REFERENCES core.sync_nodes(id),
  payload_json          JSONB NOT NULL,
  version               BIGINT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_downstream_outbox_delivery
  ON core.downstream_outbox(id, status, target_scope, target_store_id, target_node_id);

CREATE INDEX IF NOT EXISTS idx_downstream_outbox_source
  ON core.downstream_outbox(source_node_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core.downstream_inbox (
  id                    BIGSERIAL PRIMARY KEY,
  event_id              TEXT NOT NULL UNIQUE,
  source_node_id        TEXT NOT NULL REFERENCES core.sync_nodes(id),
  source_store_id       BIGINT REFERENCES core.outlet(id),
  event_type            TEXT NOT NULL,
  aggregate_type        TEXT NOT NULL,
  aggregate_id          TEXT NOT NULL,
  payload_json          JSONB NOT NULL,
  version               BIGINT NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'ACCEPTED'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'APPLIED', 'FAILED', 'REJECTED', 'DUPLICATED')),
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at            TIMESTAMPTZ,
  error_message         TEXT
);

CREATE INDEX IF NOT EXISTS idx_downstream_inbox_source_status
  ON core.downstream_inbox(source_node_id, status, received_at DESC);

CREATE TABLE IF NOT EXISTS core.downstream_event_acks (
  event_id              TEXT NOT NULL,
  node_id               TEXT NOT NULL REFERENCES core.sync_nodes(id),
  store_id              BIGINT REFERENCES core.outlet(id),
  status                TEXT NOT NULL
    CHECK (status IN ('PENDING', 'ACCEPTED', 'APPLIED', 'SENT', 'FAILED', 'REJECTED', 'DUPLICATED')),
  error_message         TEXT,
  acked_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, node_id)
);
