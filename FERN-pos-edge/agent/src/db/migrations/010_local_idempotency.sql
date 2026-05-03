CREATE TABLE IF NOT EXISTS local_idempotency (
  idem_key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  status_code INT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_local_idem_created ON local_idempotency(created_at);
