-- S3: Device auth — extend device_registry with token fields + pair-token table
ALTER TABLE core.device_registry
  ADD COLUMN IF NOT EXISTS token_hash       TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paired_at        TIMESTAMPTZ;

-- Short-lived QR pair token issued by manager before device scans
CREATE TABLE IF NOT EXISTS core.device_pair_token (
  id           BIGINT       PRIMARY KEY,
  outlet_id    BIGINT       NOT NULL REFERENCES core.outlet(id),
  token_hash   TEXT         NOT NULL UNIQUE,
  device_label TEXT         NOT NULL,
  worker_id    INT          NOT NULL CHECK (worker_id BETWEEN 128 AND 1023),
  issued_by    BIGINT       NOT NULL,
  expires_at   TIMESTAMPTZ  NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_device_pair_token_outlet ON core.device_pair_token(outlet_id);
