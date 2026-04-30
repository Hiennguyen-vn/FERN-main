-- V68: Sale void audit chain.
-- Adds structured void columns to sale_record. Free-text `note` retained for additional context.

ALTER TABLE core.sale_record
  ADD COLUMN IF NOT EXISTS void_reason_code   TEXT REFERENCES core.void_reason(code),
  ADD COLUMN IF NOT EXISTS voided_by          BIGINT,
  ADD COLUMN IF NOT EXISTS voided_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_approved_by   BIGINT,
  ADD COLUMN IF NOT EXISTS void_approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_note          TEXT;

-- Index for compliance reports.
CREATE INDEX IF NOT EXISTS ix_sale_record_void
  ON core.sale_record (void_reason_code, voided_at)
  WHERE void_reason_code IS NOT NULL;

-- Audit guard: voiding a row requires reason code + voided_by + voided_at to all be set
-- when status moves to cancelled.
ALTER TABLE core.sale_record
  DROP CONSTRAINT IF EXISTS chk_sale_void_chain_complete;
ALTER TABLE core.sale_record
  ADD CONSTRAINT chk_sale_void_chain_complete CHECK (
    status <> 'cancelled'
    OR (void_reason_code IS NOT NULL AND voided_by IS NOT NULL AND voided_at IS NOT NULL)
  );
