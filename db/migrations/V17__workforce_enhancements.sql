/* =========================================================
   V17 — Workforce enhancements: daypart, work_role, role requirements
   ========================================================= */

SET search_path TO core, public;

-- Work role within a shift (NOT a business/IAM role)
CREATE TYPE work_role_enum AS ENUM (
  'cashier', 'kitchen_staff', 'prep', 'support', 'closing_support'
);

-- Daypart classification for shifts
CREATE TYPE daypart_enum AS ENUM (
  'opening', 'breakfast', 'lunch_peak', 'afternoon', 'closing'
);

-- Add daypart + headcount to shift template
ALTER TABLE core.shift ADD COLUMN daypart daypart_enum;
ALTER TABLE core.shift ADD COLUMN headcount_required INT NOT NULL DEFAULT 1;

-- Role requirements per shift (which work roles a shift needs)
CREATE TABLE core.shift_role_requirement (
  id BIGINT PRIMARY KEY,
  shift_id BIGINT NOT NULL REFERENCES core.shift(id) ON DELETE CASCADE,
  work_role work_role_enum NOT NULL,
  required_count INT NOT NULL DEFAULT 1 CHECK (required_count >= 0),
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shift_role UNIQUE (shift_id, work_role)
);

CREATE INDEX idx_shift_role_req_shift ON core.shift_role_requirement(shift_id);

-- Add work_role to work_shift assignment
ALTER TABLE core.work_shift ADD COLUMN work_role work_role_enum;
