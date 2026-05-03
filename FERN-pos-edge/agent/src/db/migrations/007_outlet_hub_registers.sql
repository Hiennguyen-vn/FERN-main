ALTER TABLE pos_session
  ADD COLUMN IF NOT EXISTS register_code TEXT,
  ADD COLUMN IF NOT EXISTS register_display_name TEXT;

UPDATE pos_session
SET register_code = COALESCE(register_code, 'REGISTER-DEFAULT'),
    register_display_name = COALESCE(register_display_name, 'Main Register')
WHERE register_code IS NULL
   OR register_display_name IS NULL;

WITH duplicated_open_registers AS (
  SELECT
    id,
    register_code,
    register_display_name,
    ROW_NUMBER() OVER (
      PARTITION BY outlet_id, register_code
      ORDER BY opened_at ASC, id ASC
    ) AS rn
  FROM pos_session
  WHERE status = 'open'
)
UPDATE pos_session AS ps
SET register_code = duplicated_open_registers.register_code || '-LEGACY-' || ps.id::text,
    register_display_name = duplicated_open_registers.register_display_name || ' #' || ps.id::text
FROM duplicated_open_registers
WHERE ps.id = duplicated_open_registers.id
  AND duplicated_open_registers.rn > 1;

ALTER TABLE pos_session
  ALTER COLUMN register_code SET NOT NULL,
  ALTER COLUMN register_display_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_session_open_register
  ON pos_session(outlet_id, register_code)
  WHERE status = 'open';

ALTER TABLE sale_record
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'pos';

UPDATE sale_record sr
SET note = COALESCE(note, ''),
    order_type = COALESCE(order_type, 'pos')
WHERE note IS NULL
   OR order_type IS NULL;

ALTER TABLE payment
  ADD COLUMN IF NOT EXISTS offline_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
