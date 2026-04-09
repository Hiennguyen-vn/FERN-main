CREATE OR REPLACE FUNCTION core.prevent_negative_stock_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_qty NUMERIC(18,4);
  v_effective_qty NUMERIC(18,4);
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT sb.qty_on_hand
    INTO v_existing_qty
    FROM core.stock_balance sb
    WHERE sb.location_id = NEW.location_id
      AND sb.item_id = NEW.item_id;

    v_effective_qty := COALESCE(v_existing_qty, 0) + NEW.qty_on_hand;
    IF v_effective_qty < 0 THEN
      RAISE EXCEPTION 'Insufficient stock for outlet % item %', NEW.location_id, NEW.item_id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.qty_on_hand < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for outlet % item %', NEW.location_id, NEW.item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
