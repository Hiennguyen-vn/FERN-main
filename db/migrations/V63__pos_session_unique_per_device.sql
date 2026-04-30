-- Reassert the operational POS rule: one edge device owns one open session
-- until that session is closed. register_code remains audit/display metadata,
-- not a partition key for concurrent open sessions on the same machine.

WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY outlet_id, device_id
      ORDER BY opened_at DESC, id DESC
    ) AS kept_id,
    ROW_NUMBER() OVER (
      PARTITION BY outlet_id, device_id
      ORDER BY opened_at DESC, id DESC
    ) AS rn
  FROM core.pos_session
  WHERE status = 'open'::core.pos_session_status_enum
    AND device_id IS NOT NULL
)
UPDATE core.pos_session AS ps
SET status = 'closed'::core.pos_session_status_enum,
    closed_at = COALESCE(ps.closed_at, NOW()),
    note = CONCAT_WS(E'\n', ps.note, 'Auto-closed duplicate open session for same device; superseded by session ' || ranked.kept_id::text),
    updated_at = NOW()
FROM ranked
WHERE ps.id = ranked.id
  AND ranked.rn > 1;

DROP INDEX IF EXISTS core.uq_pos_session_open_per_device_register;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_session_open_per_device
  ON core.pos_session(outlet_id, device_id)
  WHERE status = 'open'::core.pos_session_status_enum
    AND device_id IS NOT NULL;
