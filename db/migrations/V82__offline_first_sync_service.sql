-- Offline-first store synchronization tables.
-- These tables support central sync-service and store-edge local sync agents without
-- database-to-database replication or cross-node direct writes.

CREATE TABLE IF NOT EXISTS core.sync_nodes (
  id                    TEXT PRIMARY KEY,
  store_id              BIGINT NOT NULL REFERENCES core.outlet(id),
  node_code             TEXT NOT NULL UNIQUE,
  node_name             TEXT NOT NULL,
  node_type             TEXT NOT NULL DEFAULT 'STORE_EDGE'
    CHECK (node_type IN ('STORE_EDGE','CENTRAL','BACKOFFICE')),
  device_id             BIGINT UNIQUE,
  worker_id             INT UNIQUE
    CHECK (worker_id IS NULL OR worker_id BETWEEN 128 AND 1023),
  hardware_fingerprint  TEXT,
  public_key            TEXT,
  client_secret_hash    TEXT,
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  last_seen_at          TIMESTAMPTZ,
  last_upload_at        TIMESTAMPTZ,
  last_download_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_nodes_store_status
  ON core.sync_nodes(store_id, status);

CREATE TABLE IF NOT EXISTS core.central_outbox (
  id                    BIGSERIAL PRIMARY KEY,
  event_type            TEXT NOT NULL,
  aggregate_type        TEXT NOT NULL,
  aggregate_id          TEXT NOT NULL,
  target_scope          TEXT NOT NULL
    CHECK (target_scope IN ('ALL_STORES','STORE','STORE_GROUP')),
  target_store_id       BIGINT REFERENCES core.outlet(id),
  target_store_group_id BIGINT,
  payload_json          JSONB NOT NULL,
  version               BIGINT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PUBLISHED','FAILED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_central_outbox_download
  ON core.central_outbox(id, status, target_scope, target_store_id);

CREATE INDEX IF NOT EXISTS idx_central_outbox_aggregate
  ON core.central_outbox(aggregate_type, aggregate_id, version DESC);

CREATE TABLE IF NOT EXISTS core.central_inbox (
  id                    BIGSERIAL PRIMARY KEY,
  event_id              TEXT NOT NULL UNIQUE,
  source_node_id        TEXT NOT NULL REFERENCES core.sync_nodes(id),
  source_store_id       BIGINT NOT NULL REFERENCES core.outlet(id),
  event_type            TEXT NOT NULL,
  aggregate_type        TEXT NOT NULL,
  aggregate_id          TEXT NOT NULL,
  payload_json          JSONB NOT NULL,
  version               BIGINT NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'ACCEPTED'
    CHECK (status IN ('PENDING','ACCEPTED','APPLIED','FAILED','REJECTED','DUPLICATED')),
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at            TIMESTAMPTZ,
  error_message         TEXT
);

CREATE INDEX IF NOT EXISTS idx_central_inbox_store_status
  ON core.central_inbox(source_store_id, status, received_at DESC);

CREATE TABLE IF NOT EXISTS core.sync_event_acks (
  event_id              TEXT NOT NULL,
  node_id               TEXT NOT NULL REFERENCES core.sync_nodes(id),
  store_id              BIGINT NOT NULL REFERENCES core.outlet(id),
  status                TEXT NOT NULL
    CHECK (status IN ('PENDING','ACCEPTED','APPLIED','SENT','FAILED','REJECTED','DUPLICATED')),
  error_message         TEXT,
  acked_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, node_id)
);

CREATE TABLE IF NOT EXISTS core.sync_cursor (
  stream_name           TEXT PRIMARY KEY,
  last_cursor           TEXT NOT NULL DEFAULT '0',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.sync_offsets (
  node_id               TEXT NOT NULL,
  stream_name           TEXT NOT NULL,
  last_cursor           TEXT NOT NULL DEFAULT '0',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (node_id, stream_name)
);

CREATE TABLE IF NOT EXISTS core.sync_conflicts (
  id                    BIGSERIAL PRIMARY KEY,
  event_id              TEXT,
  node_id               TEXT,
  store_id              BIGINT,
  aggregate_type        TEXT NOT NULL,
  aggregate_id          TEXT NOT NULL,
  conflict_type         TEXT NOT NULL,
  resolution            TEXT NOT NULL DEFAULT 'MANUAL_REVIEW',
  local_version         BIGINT,
  remote_version        BIGINT,
  payload_json          JSONB,
  status                TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','RESOLVED','IGNORED')),
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status_store
  ON core.sync_conflicts(status, store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core.sync_logs (
  id                    BIGSERIAL PRIMARY KEY,
  node_id               TEXT,
  store_id              BIGINT,
  direction             TEXT NOT NULL
    CHECK (direction IN ('CENTRAL_TO_STORE','STORE_TO_CENTRAL')),
  status                TEXT NOT NULL,
  event_count           INT NOT NULL DEFAULT 0,
  message               TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS core.sync_outbox (
  id                    TEXT PRIMARY KEY,
  event_type            TEXT NOT NULL,
  aggregate_type        TEXT NOT NULL,
  aggregate_id          TEXT NOT NULL,
  payload_json          JSONB NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','FAILED','SENT')),
  retry_count           INT NOT NULL DEFAULT 0,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
  ON core.sync_outbox(status, created_at)
  WHERE status IN ('PENDING','FAILED');

CREATE TABLE IF NOT EXISTS core.sync_inbox (
  id                    BIGSERIAL PRIMARY KEY,
  event_id              TEXT NOT NULL UNIQUE,
  source_node_id        TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  aggregate_type        TEXT NOT NULL,
  aggregate_id          TEXT NOT NULL,
  payload_json          JSONB NOT NULL,
  version               BIGINT NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPLIED','FAILED','REJECTED','DUPLICATED')),
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at            TIMESTAMPTZ,
  error_message         TEXT
);

CREATE TABLE IF NOT EXISTS core.local_node_config (
  id                    BIGSERIAL PRIMARY KEY,
  store_id              BIGINT NOT NULL,
  node_id               TEXT NOT NULL,
  node_code             TEXT NOT NULL,
  central_sync_url      TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  last_success_sync_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_local_node_config_node UNIQUE (node_id)
);

CREATE TABLE IF NOT EXISTS core.local_applied_versions (
  aggregate_type        TEXT NOT NULL,
  aggregate_id          TEXT NOT NULL,
  version               BIGINT NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (aggregate_type, aggregate_id)
);
