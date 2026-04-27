-- Runtime role / RLS hardening, inventory sale reversal, and short-lock outbox relay support.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fern_app') THEN
    CREATE ROLE fern_app LOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fern_app', current_database());
END$$;

GRANT USAGE ON SCHEMA core TO fern_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO fern_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core TO fern_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fern_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT USAGE, SELECT ON SEQUENCES TO fern_app;

GRANT USAGE ON SCHEMA finance TO fern_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finance TO fern_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA finance TO fern_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fern_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT USAGE, SELECT ON SEQUENCES TO fern_app;

CREATE OR REPLACE FUNCTION core.fn_outlet_allowed(p_outlet_id BIGINT) RETURNS BOOLEAN AS $$
DECLARE
  v_raw_id TEXT := current_setting('fern.outlet_id', true);
  v_raw_ids TEXT := current_setting('fern.outlet_ids', true);
  v_token TEXT;
BEGIN
  IF p_outlet_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_raw_id = 'all' THEN
    RETURN TRUE;
  END IF;
  IF v_raw_id IS NOT NULL AND v_raw_id <> '' AND v_raw_id <> 'unset' AND v_raw_id <> 'set' THEN
    RETURN p_outlet_id = v_raw_id::BIGINT;
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

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('sale_record', 'p_sale_record_outlet', 'outlet_id'),
      ('sale_item', 'p_sale_item_outlet', 'outlet_id'),
      ('payment', 'p_payment_outlet', 'outlet_id'),
      ('inventory_transaction', 'p_inventory_txn_outlet', 'outlet_id'),
      ('stock_balance', 'p_stock_balance_outlet', 'location_id'),
      ('pos_session', 'p_pos_session_outlet', 'outlet_id'),
      ('processed_events', 'p_processed_events_outlet', 'outlet_id'),
      ('device_registry', 'p_device_registry_outlet', 'outlet_id'),
      ('ordering_table', 'p_ordering_table_outlet', 'outlet_id'),
      ('product_outlet_availability', 'p_product_outlet_availability', 'outlet_id'),
      ('product_price', 'p_product_price_outlet', 'outlet_id'),
      ('expense_record', 'p_expense_record_outlet', 'outlet_id')
    ) AS t(table_name, policy_name, outlet_column)
  LOOP
    EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON core.%I', r.policy_name, r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON core.%I USING (core.fn_outlet_allowed(%I)) WITH CHECK (core.fn_outlet_allowed(%I))',
      r.policy_name, r.table_name, r.outlet_column, r.outlet_column
    );
  END LOOP;
END$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('invoice', 'p_invoice_outlet', 'outlet_id'),
      ('outlet_invoice_sequence', 'p_outlet_invoice_sequence_outlet', 'outlet_id')
    ) AS t(table_name, policy_name, outlet_column)
  LOOP
    EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON finance.%I', r.policy_name, r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON finance.%I USING (core.fn_outlet_allowed(%I)) WITH CHECK (core.fn_outlet_allowed(%I))',
      r.policy_name, r.table_name, r.outlet_column, r.outlet_column
    );
  END LOOP;
END$$;

ALTER TABLE finance.invoice_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.invoice_line FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_invoice_line_outlet ON finance.invoice_line;
CREATE POLICY p_invoice_line_outlet ON finance.invoice_line
  USING (
    EXISTS (
      SELECT 1
      FROM finance.invoice inv
      WHERE inv.id = finance.invoice_line.invoice_id
        AND core.fn_outlet_allowed(inv.outlet_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM finance.invoice inv
      WHERE inv.id = finance.invoice_line.invoice_id
        AND core.fn_outlet_allowed(inv.outlet_id)
    )
  );

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET fern.outlet_id = ''unset''', current_database());
  EXECUTE format('ALTER DATABASE %I SET fern.outlet_ids = ''''', current_database());
END$$;

ALTER TYPE inventory_txn_type_enum ADD VALUE IF NOT EXISTS 'sale_reversal';
