-- V58: Loyalty MVP — customer + points + OTP. PDPL-aware (Nghị định 13/2023):
--   * explicit consent flags
--   * soft-delete via deleted_at for right-to-erasure
--   * append-only points_ledger for auditability

CREATE SCHEMA IF NOT EXISTS crm;

-- Mirror the privilege model used for `core`: grant fern_app full DML and let
-- ALTER DEFAULT PRIVILEGES propagate to tables created later in this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fern_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA crm TO fern_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fern_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT USAGE, SELECT ON SEQUENCES TO fern_app';
  END IF;
END
$$;

CREATE TABLE crm.customer (
  id BIGINT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  phone_verified_at TIMESTAMPTZ NULL,
  full_name VARCHAR(255),
  birthday DATE NULL,
  consent_marketing BOOLEAN NOT NULL DEFAULT FALSE,
  consent_data_processing BOOLEAN NOT NULL DEFAULT TRUE,
  points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,

  CONSTRAINT chk_phone_format CHECK (phone ~ '^\+?[0-9]{8,15}$')
);

-- Phone unique only among non-deleted records (allow re-registration after erasure).
CREATE UNIQUE INDEX uq_customer_phone_active
  ON crm.customer(phone)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_customer_birthday ON crm.customer(birthday) WHERE deleted_at IS NULL AND birthday IS NOT NULL;

CREATE TABLE crm.points_ledger (
  id BIGINT PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES crm.customer(id),
  sale_id BIGINT NULL,
  delta INTEGER NOT NULL,
  reason VARCHAR(50) NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_points_ledger_customer ON crm.points_ledger(customer_id, created_at DESC);
CREATE INDEX idx_points_ledger_sale ON crm.points_ledger(sale_id) WHERE sale_id IS NOT NULL;

CREATE TABLE crm.otp_request (
  id BIGINT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code_hash VARCHAR(128) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_request_phone_active
  ON crm.otp_request(phone, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE TRIGGER trg_crm_customer_updated_at
BEFORE UPDATE ON crm.customer
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

COMMENT ON TABLE crm.customer IS 'Loyalty customer. PDPL: soft-delete via deleted_at for right-to-erasure.';
COMMENT ON TABLE crm.points_ledger IS 'Append-only points history. balance_after captures balance at time of entry.';
COMMENT ON TABLE crm.otp_request IS 'OTP requests for phone verification. Mock provider in dev (code "123456").';
