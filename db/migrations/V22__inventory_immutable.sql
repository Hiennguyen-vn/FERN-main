-- inventory_transaction is append-only ledger. Prevent UPDATE/DELETE.
-- Use compensating INSERT entries instead.
CREATE OR REPLACE FUNCTION core.prevent_inventory_transaction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transaction is append-only; create a compensating entry instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_inventory_transaction_immutable
  BEFORE UPDATE OR DELETE ON core.inventory_transaction
  FOR EACH ROW EXECUTE FUNCTION core.prevent_inventory_transaction_mutation();

-- Replace sync_stock_balance trigger: INSERT-only (drop reverse-delta logic for UPDATE/DELETE)
CREATE OR REPLACE FUNCTION core.sync_stock_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM core.apply_stock_delta(
      NEW.outlet_id,
      NEW.item_id,
      NEW.qty_change,
      NEW.unit_cost,
      NULL
    );
    RETURN NEW;
  END IF;
  -- UPDATE/DELETE blocked by trg_inventory_transaction_immutable — never reached.
  RETURN NULL;
END;
$$;
