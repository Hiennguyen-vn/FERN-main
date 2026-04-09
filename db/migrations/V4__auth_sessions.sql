CREATE TABLE core.auth_session (
  session_id VARCHAR(96) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES core.app_user(id),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  refreshed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id BIGINT REFERENCES core.app_user(id),
  revoke_reason VARCHAR(64),
  user_agent VARCHAR(512),
  client_ip VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_auth_session_expiry CHECK (expires_at >= issued_at),
  CONSTRAINT chk_auth_session_revocation CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoke_reason IS NULL)
    OR revoked_at IS NOT NULL
  )
);

CREATE INDEX idx_auth_session_user_id
  ON core.auth_session(user_id, issued_at DESC);

CREATE INDEX idx_auth_session_active_window
  ON core.auth_session(user_id, revoked_at, expires_at DESC);

CREATE TRIGGER trg_auth_session_updated_at
BEFORE UPDATE ON core.auth_session
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();
