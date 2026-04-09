SET search_path TO core, public;

CREATE TABLE core.service_instance (
  id BIGINT PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  version VARCHAR(100) NOT NULL,
  runtime VARCHAR(50) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL CHECK (port BETWEEN 1 AND 65535),
  status VARCHAR(30) NOT NULL,
  first_registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_offline_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_service_instance_endpoint UNIQUE (service_name, host, port)
);

CREATE INDEX idx_service_instance_service_name ON core.service_instance(service_name);
CREATE INDEX idx_service_instance_status ON core.service_instance(status);
CREATE INDEX idx_service_instance_last_heartbeat_at ON core.service_instance(last_heartbeat_at);

CREATE TABLE core.service_assignment (
  id BIGINT PRIMARY KEY,
  instance_id BIGINT REFERENCES core.service_instance(id) ON DELETE CASCADE,
  service_name VARCHAR(100) NOT NULL,
  region_code VARCHAR(50),
  outlet_id BIGINT REFERENCES core.outlet(id),
  capability VARCHAR(100),
  desired_instances INT NOT NULL DEFAULT 1 CHECK (desired_instances > 0),
  routing_weight INT NOT NULL DEFAULT 100 CHECK (routing_weight >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_assignment_service_name ON core.service_assignment(service_name);
CREATE INDEX idx_service_assignment_instance_id ON core.service_assignment(instance_id);

CREATE TABLE core.service_config_profile (
  id BIGINT PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  config_version BIGINT NOT NULL,
  etag VARCHAR(128) NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_service_config_profile_active
  ON core.service_config_profile(service_name)
  WHERE active = TRUE;

CREATE TABLE core.feature_flag (
  id BIGINT PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  flag_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_feature_flag_key UNIQUE (service_name, flag_key)
);

CREATE TABLE core.service_release (
  id BIGINT PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  version VARCHAR(100) NOT NULL,
  image_ref TEXT NOT NULL,
  status VARCHAR(30) NOT NULL,
  change_summary TEXT,
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_release_service_name ON core.service_release(service_name);

CREATE TABLE core.service_rollout (
  id BIGINT PRIMARY KEY,
  release_id BIGINT NOT NULL REFERENCES core.service_release(id) ON DELETE CASCADE,
  stage VARCHAR(30) NOT NULL,
  desired_state VARCHAR(30) NOT NULL,
  actual_state VARCHAR(30) NOT NULL,
  assignment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_ref VARCHAR(100),
  error_summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_rollout_release_id ON core.service_rollout(release_id);

CREATE TABLE core.idempotency_keys (
  service_name VARCHAR(100) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,
  response_code INT,
  response_body JSONB,
  resource_id VARCHAR(100),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (service_name, idempotency_key)
);

CREATE INDEX idx_idempotency_keys_expires_at ON core.idempotency_keys(expires_at);

CREATE TRIGGER trg_service_instance_updated_at
BEFORE UPDATE ON core.service_instance
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_service_assignment_updated_at
BEFORE UPDATE ON core.service_assignment
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_service_config_profile_updated_at
BEFORE UPDATE ON core.service_config_profile
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_feature_flag_updated_at
BEFORE UPDATE ON core.feature_flag
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_service_release_updated_at
BEFORE UPDATE ON core.service_release
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_service_rollout_updated_at
BEFORE UPDATE ON core.service_rollout
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_idempotency_keys_updated_at
BEFORE UPDATE ON core.idempotency_keys
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
