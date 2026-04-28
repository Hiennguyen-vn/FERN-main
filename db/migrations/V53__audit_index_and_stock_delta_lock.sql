CREATE INDEX IF NOT EXISTS idx_audit_log_entity_actor_time
  ON core.audit_log(entity_name, entity_id, actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION core.apply_stock_delta(
  p_outlet_id BIGINT,
  p_item_id BIGINT,
  p_qty_delta NUMERIC(18,4),
  p_unit_cost NUMERIC(18,4),
  p_last_count_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM core.stock_balance
  WHERE location_id = p_outlet_id
    AND item_id = p_item_id
  FOR UPDATE;

  INSERT INTO core.stock_balance (
    location_id,
    item_id,
    qty_on_hand,
    unit_cost,
    last_count_date,
    updated_at
  )
  VALUES (
    p_outlet_id,
    p_item_id,
    p_qty_delta,
    p_unit_cost,
    p_last_count_date,
    NOW()
  )
  ON CONFLICT (location_id, item_id)
  DO UPDATE SET
    qty_on_hand = core.stock_balance.qty_on_hand + EXCLUDED.qty_on_hand,
    unit_cost = COALESCE(EXCLUDED.unit_cost, core.stock_balance.unit_cost),
    last_count_date = COALESCE(EXCLUDED.last_count_date, core.stock_balance.last_count_date),
    updated_at = NOW();
END;
$$;
