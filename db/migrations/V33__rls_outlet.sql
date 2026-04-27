-- V33: Row-Level Security per outlet for chuỗi cafe multi-tenant safety.
--
-- Each request sets `SET LOCAL fern.outlet_id = '<id>'` for a pinned outlet,
-- `SET LOCAL fern.outlet_ids = '1,2,3'` for a scoped multi-outlet user, or
-- `fern.outlet_id = 'all'` for internal/superadmin cross-outlet work. Policies
-- use these GUCs to restrict reads/writes to the caller's outlet set.
-- App connection is granted FORCE ROW LEVEL SECURITY only
-- on application role, so superuser / migration role bypasses RLS as expected.
--
-- Pattern:
--   * Default policy: outlet_id is explicitly allowed by GUC, OR GUC = 'all'
--     (superadmin/internal scope).
--   * BYPASS via GRANT to migration / sync internal role only.
--
-- The fern.outlet_id GUC defaults to 'unset' which matches no rows — fail closed.

-- Helper: read outlet_id GUC; treat unset / 'all' / 'set' as sentinel.
CREATE OR REPLACE FUNCTION core.fn_current_outlet_id() RETURNS BIGINT AS $$
DECLARE
  v_raw TEXT := current_setting('fern.outlet_id', true);
BEGIN
  IF v_raw IS NULL OR v_raw = '' OR v_raw = 'unset' THEN
    RETURN NULL;
  END IF;
  IF v_raw = 'all' THEN
    RETURN -1;
  END IF;
  IF v_raw = 'set' THEN
    RETURN NULL;
  END IF;
  RETURN v_raw::BIGINT;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION core.fn_outlet_allowed(p_outlet_id BIGINT) RETURNS BOOLEAN AS $$
DECLARE
  v_outlet_id BIGINT := core.fn_current_outlet_id();
  v_raw_ids TEXT := current_setting('fern.outlet_ids', true);
  v_token TEXT;
BEGIN
  IF p_outlet_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_outlet_id = -1 THEN
    RETURN TRUE;
  END IF;
  IF v_outlet_id IS NOT NULL THEN
    RETURN p_outlet_id = v_outlet_id;
  END IF;
  IF v_raw_ids IS NULL OR v_raw_ids = '' OR v_raw_ids = 'unset' THEN
    RETURN FALSE;
  END IF;
  IF v_raw_ids = 'all' THEN
    RETURN TRUE;
  END IF;
  FOREACH v_token IN ARRAY string_to_array(v_raw_ids, ',') LOOP
    IF trim(v_token) <> '' AND p_outlet_id = trim(v_token)::BIGINT THEN
      RETURN TRUE;
    END IF;
  END LOOP;
  RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

-- Macro: outlet match policy (unset GUC blocks all rows; 'all' means superadmin/internal all).
-- Note: applied per-table because Postgres RLS policies are per-table.

-- sale_record
ALTER TABLE core.sale_record ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_sale_record_outlet ON core.sale_record;
CREATE POLICY p_sale_record_outlet ON core.sale_record
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- sale_item
ALTER TABLE core.sale_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_sale_item_outlet ON core.sale_item;
CREATE POLICY p_sale_item_outlet ON core.sale_item
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- payment
ALTER TABLE core.payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_payment_outlet ON core.payment;
CREATE POLICY p_payment_outlet ON core.payment
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- inventory_transaction
ALTER TABLE core.inventory_transaction ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_inventory_txn_outlet ON core.inventory_transaction;
CREATE POLICY p_inventory_txn_outlet ON core.inventory_transaction
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- stock_balance — location_id is the outlet_id in this schema (V1 alias)
ALTER TABLE core.stock_balance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_stock_balance_outlet ON core.stock_balance;
CREATE POLICY p_stock_balance_outlet ON core.stock_balance
  USING (
    core.fn_outlet_allowed(location_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(location_id)
  );

-- pos_session
ALTER TABLE core.pos_session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pos_session_outlet ON core.pos_session;
CREATE POLICY p_pos_session_outlet ON core.pos_session
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- processed_events
ALTER TABLE core.processed_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_processed_events_outlet ON core.processed_events;
CREATE POLICY p_processed_events_outlet ON core.processed_events
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- device_registry
ALTER TABLE core.device_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_device_registry_outlet ON core.device_registry;
CREATE POLICY p_device_registry_outlet ON core.device_registry
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- ordering_table
ALTER TABLE core.ordering_table ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ordering_table_outlet ON core.ordering_table;
CREATE POLICY p_ordering_table_outlet ON core.ordering_table
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- product_outlet_availability + product_price are per-outlet pricing rules
ALTER TABLE core.product_outlet_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_product_outlet_availability ON core.product_outlet_availability;
CREATE POLICY p_product_outlet_availability ON core.product_outlet_availability
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

ALTER TABLE core.product_price ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_product_price_outlet ON core.product_price;
CREATE POLICY p_product_price_outlet ON core.product_price
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- expense_record
ALTER TABLE core.expense_record ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_expense_record_outlet ON core.expense_record;
CREATE POLICY p_expense_record_outlet ON core.expense_record
  USING (
    core.fn_outlet_allowed(outlet_id)
  )
  WITH CHECK (
    core.fn_outlet_allowed(outlet_id)
  );

-- Default GUC so that connections forgetting to set it fail closed.
-- App must call: SET LOCAL fern.outlet_id = '<id>' or 'all', and/or
-- SET LOCAL fern.outlet_ids = '<csv>', before queries.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET fern.outlet_id = ''unset''', current_database());
  EXECUTE format('ALTER DATABASE %I SET fern.outlet_ids = ''''', current_database());
END$$;

ALTER TABLE core.sale_record FORCE ROW LEVEL SECURITY;
ALTER TABLE core.sale_item FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment FORCE ROW LEVEL SECURITY;
ALTER TABLE core.inventory_transaction FORCE ROW LEVEL SECURITY;
ALTER TABLE core.stock_balance FORCE ROW LEVEL SECURITY;
ALTER TABLE core.pos_session FORCE ROW LEVEL SECURITY;
ALTER TABLE core.processed_events FORCE ROW LEVEL SECURITY;
ALTER TABLE core.device_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE core.ordering_table FORCE ROW LEVEL SECURITY;
ALTER TABLE core.product_outlet_availability FORCE ROW LEVEL SECURITY;
ALTER TABLE core.product_price FORCE ROW LEVEL SECURITY;
ALTER TABLE core.expense_record FORCE ROW LEVEL SECURITY;
