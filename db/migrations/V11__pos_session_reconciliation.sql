CREATE TABLE IF NOT EXISTS core.pos_session_reconciliation (
  session_id BIGINT PRIMARY KEY REFERENCES core.pos_session(id) ON DELETE CASCADE,
  reconciled_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  reconciled_at TIMESTAMPTZ NOT NULL,
  expected_total NUMERIC(18,2) NOT NULL CHECK (expected_total >= 0),
  actual_total NUMERIC(18,2) NOT NULL CHECK (actual_total >= 0),
  discrepancy_total NUMERIC(18,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.pos_session_reconciliation_line (
  session_id BIGINT NOT NULL REFERENCES core.pos_session_reconciliation(session_id) ON DELETE CASCADE,
  payment_method payment_method_enum NOT NULL,
  expected_amount NUMERIC(18,2) NOT NULL CHECK (expected_amount >= 0),
  actual_amount NUMERIC(18,2) NOT NULL CHECK (actual_amount >= 0),
  discrepancy_amount NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, payment_method)
);

CREATE INDEX IF NOT EXISTS idx_pos_session_reconciliation_reconciled_at
  ON core.pos_session_reconciliation(reconciled_at DESC);

CREATE TRIGGER trg_pos_session_reconciliation_updated_at
BEFORE UPDATE ON core.pos_session_reconciliation
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_pos_session_reconciliation_line_updated_at
BEFORE UPDATE ON core.pos_session_reconciliation_line
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
