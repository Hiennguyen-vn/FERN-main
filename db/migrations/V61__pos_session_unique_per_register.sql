-- Allow multiple active registers behind the same outlet edge device.
--
-- V49 constrained open POS sessions by (outlet_id, device_id, business_date).
-- That blocks multi-terminal setups where one edge hub serves multiple browser
-- registers. Scope the open-session uniqueness to register_code as well.

DROP INDEX IF EXISTS core.uq_pos_session_open_per_device;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_session_open_per_device_register
  ON core.pos_session(outlet_id, device_id, register_code, business_date)
  WHERE status = 'open' AND device_id IS NOT NULL AND register_code IS NOT NULL;
