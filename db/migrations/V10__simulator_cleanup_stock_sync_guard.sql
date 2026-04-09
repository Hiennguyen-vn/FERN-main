-- Allow data-simulator cleanup to delete inventory_transaction rows without firing
-- stock_balance sync (avoids negative-stock guard) using a session-local GUC that
-- any DB user can set — unlike session_replication_role (superuser-only).
ALTER TABLE core.simulator_run
    ADD COLUMN IF NOT EXISTS cleaned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cleanup_summary_json TEXT;

CREATE OR REPLACE FUNCTION core.sync_stock_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF nullif(current_setting('fern.simulator_cleanup', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

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

  IF TG_OP = 'UPDATE' THEN
    PERFORM core.apply_stock_delta(
      OLD.outlet_id,
      OLD.item_id,
      OLD.qty_change * -1,
      NULL,
      NULL
    );

    PERFORM core.apply_stock_delta(
      NEW.outlet_id,
      NEW.item_id,
      NEW.qty_change,
      NEW.unit_cost,
      NULL
    );
    RETURN NEW;
  END IF;

  PERFORM core.apply_stock_delta(
    OLD.outlet_id,
    OLD.item_id,
    OLD.qty_change * -1,
    NULL,
    NULL
  );
  RETURN OLD;
END;
$$;
