-- V76: Reconcile core.stock_balance from core.inventory_transaction.
-- Used by simulator after cleanup runs (which set fern.simulator_cleanup='on'
-- and bypass core.sync_stock_balance trigger). Without reconcile, stock_balance
-- can drift from ledger in simulator-only environments.

CREATE OR REPLACE FUNCTION core.reconcile_stock_balance_from_ledger()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  -- Recompute qty_on_hand per (outlet, item) from inventory_transaction sum.
  WITH agg AS (
    SELECT outlet_id AS location_id,
           item_id,
           COALESCE(SUM(qty_change), 0) AS qty_on_hand
    FROM core.inventory_transaction
    GROUP BY outlet_id, item_id
  )
  INSERT INTO core.stock_balance (location_id, item_id, qty_on_hand, unit_cost, updated_at)
  SELECT a.location_id, a.item_id, a.qty_on_hand, NULL, NOW()
  FROM agg a
  ON CONFLICT (location_id, item_id) DO UPDATE
     SET qty_on_hand = EXCLUDED.qty_on_hand,
         updated_at = NOW();
  GET DIAGNOSTICS affected = ROW_COUNT;

  -- Zero-out balances for (location, item) pairs that no longer have ledger rows.
  UPDATE core.stock_balance sb
  SET qty_on_hand = 0,
      updated_at = NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM core.inventory_transaction it
    WHERE it.outlet_id = sb.location_id AND it.item_id = sb.item_id
  )
  AND sb.qty_on_hand <> 0;

  RETURN affected;
END;
$$;

COMMENT ON FUNCTION core.reconcile_stock_balance_from_ledger() IS
  'Rebuilds stock_balance from inventory_transaction. '
  'Call after simulator cleanup (fern.simulator_cleanup GUC) to fix drift. '
  'Production should never need this — sync_stock_balance trigger maintains invariant.';

GRANT EXECUTE ON FUNCTION core.reconcile_stock_balance_from_ledger() TO fern_app;
