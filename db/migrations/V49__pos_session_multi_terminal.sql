-- Multi-terminal POS session support.
--
-- Context:
--   pos_session already carries device_id (V39) and register_code, but lookup queries
--   (findOpenPosSessionIdForOutlet) returned ANY open session at an outlet, ignoring
--   the originating terminal. For multi-terminal outlets (3-5 terminals/outlet) this
--   silently mis-attributes public/QR orders to the wrong session.
--
-- Changes:
--   1. Partial unique constraint preventing one device from holding 2 open sessions
--      simultaneously. Closed sessions are excluded so a device can open a new
--      session next business day.
--   2. Composite index for fast (outlet_id, device_id, status='open') lookups.

-- 1) Prevent same device opening 2 concurrent sessions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_session_open_per_device
  ON core.pos_session(outlet_id, device_id, business_date)
  WHERE status = 'open' AND device_id IS NOT NULL;

-- 2) Composite lookup index for "open session at this outlet for this device".
CREATE INDEX IF NOT EXISTS idx_pos_session_outlet_device_status
  ON core.pos_session(outlet_id, device_id, status)
  WHERE device_id IS NOT NULL;
