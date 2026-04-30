ALTER TABLE core.payroll_period
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_note TEXT;

ALTER TABLE core.payroll_period
  DROP CONSTRAINT IF EXISTS chk_payroll_period_status;

ALTER TABLE core.payroll_period
  ADD CONSTRAINT chk_payroll_period_status CHECK (status IN ('open', 'closed'));

CREATE INDEX IF NOT EXISTS idx_payroll_period_status
  ON core.payroll_period(status);
