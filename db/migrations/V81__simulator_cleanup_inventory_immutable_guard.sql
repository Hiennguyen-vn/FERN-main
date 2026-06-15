-- Allow simulator-owned cleanup sessions to remove immutable inventory ledger rows.
-- Normal application traffic remains append-only and must use compensating entries.
CREATE OR REPLACE FUNCTION core.prevent_inventory_transaction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nullif(current_setting('fern.simulator_cleanup', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'inventory_transaction is append-only; create a compensating entry instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;
