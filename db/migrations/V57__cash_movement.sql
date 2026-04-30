-- V57: POS cash movement ledger.
-- Append-only ledger of cash flows during a POS session: opening float, paid-in, paid-out,
-- cash sales (mirror), drops, close count. Used to compute true cash variance at shift close.

CREATE TABLE core.cash_movement (
  id BIGINT PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES core.pos_session(id) ON DELETE CASCADE,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  type VARCHAR(20) NOT NULL CHECK (type IN
    ('OPEN_FLOAT','PAID_IN','PAID_OUT','SALE_CASH','DROP','CLOSE_COUNT')),
  amount NUMERIC(15,2) NOT NULL,
  reason VARCHAR(255),
  reference_sale_id BIGINT NULL,
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_movement_session ON core.cash_movement(session_id);
CREATE INDEX idx_cash_movement_outlet_created ON core.cash_movement(outlet_id, created_at);

-- Per-session cash summary view: net expected vs counted, plus variance.
CREATE OR REPLACE VIEW core.cash_session_summary AS
SELECT
  s.id AS session_id,
  s.outlet_id,
  s.business_date,
  COALESCE(SUM(CASE WHEN cm.type = 'OPEN_FLOAT' THEN cm.amount ELSE 0 END), 0)  AS open_float,
  COALESCE(SUM(CASE WHEN cm.type = 'SALE_CASH' THEN cm.amount ELSE 0 END), 0)   AS sales_cash,
  COALESCE(SUM(CASE WHEN cm.type = 'PAID_IN'   THEN cm.amount ELSE 0 END), 0)   AS paid_in,
  COALESCE(SUM(CASE WHEN cm.type = 'PAID_OUT'  THEN cm.amount ELSE 0 END), 0)   AS paid_out,
  COALESCE(SUM(CASE WHEN cm.type = 'DROP'      THEN cm.amount ELSE 0 END), 0)   AS drops,
  COALESCE(MAX(CASE WHEN cm.type = 'CLOSE_COUNT' THEN cm.amount END), NULL)     AS counted,
  COALESCE(SUM(CASE WHEN cm.type = 'OPEN_FLOAT' THEN cm.amount
                    WHEN cm.type = 'SALE_CASH' THEN cm.amount
                    WHEN cm.type = 'PAID_IN'   THEN cm.amount
                    WHEN cm.type = 'PAID_OUT'  THEN -cm.amount
                    WHEN cm.type = 'DROP'      THEN -cm.amount
                    ELSE 0 END), 0) AS expected_total,
  (COALESCE(MAX(CASE WHEN cm.type = 'CLOSE_COUNT' THEN cm.amount END), 0)
    - COALESCE(SUM(CASE WHEN cm.type = 'OPEN_FLOAT' THEN cm.amount
                        WHEN cm.type = 'SALE_CASH' THEN cm.amount
                        WHEN cm.type = 'PAID_IN'   THEN cm.amount
                        WHEN cm.type = 'PAID_OUT'  THEN -cm.amount
                        WHEN cm.type = 'DROP'      THEN -cm.amount
                        ELSE 0 END), 0)) AS variance
FROM core.pos_session s
LEFT JOIN core.cash_movement cm ON cm.session_id = s.id
GROUP BY s.id, s.outlet_id, s.business_date;

COMMENT ON TABLE core.cash_movement IS
  'Append-only cash drawer ledger. Variance computed in core.cash_session_summary view.';
