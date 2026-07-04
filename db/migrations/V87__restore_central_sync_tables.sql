-- Backfill sync tables for local databases that advanced past V82 without
-- creating the central/store sync schema. Keep this idempotent so newer
-- environments remain unchanged.

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
