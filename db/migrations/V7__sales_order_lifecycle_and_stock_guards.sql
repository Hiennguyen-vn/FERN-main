ALTER TYPE sale_order_status_enum ADD VALUE IF NOT EXISTS 'order_created';
ALTER TYPE sale_order_status_enum ADD VALUE IF NOT EXISTS 'order_approved';
ALTER TYPE sale_order_status_enum ADD VALUE IF NOT EXISTS 'payment_done';

CREATE OR REPLACE FUNCTION core.prevent_negative_stock_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.qty_on_hand < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for outlet % item %', NEW.location_id, NEW.item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_balance_prevent_negative ON core.stock_balance;
CREATE TRIGGER trg_stock_balance_prevent_negative
BEFORE INSERT OR UPDATE ON core.stock_balance
FOR EACH ROW EXECUTE FUNCTION core.prevent_negative_stock_balance();

ALTER TABLE core.sale_item_transaction
  ADD COLUMN item_id BIGINT;

UPDATE core.sale_item_transaction sit
SET item_id = it.item_id
FROM core.inventory_transaction it
WHERE sit.inventory_transaction_id = it.id
  AND sit.item_id IS NULL;

ALTER TABLE core.sale_item_transaction
  ALTER COLUMN item_id SET NOT NULL;

ALTER TABLE core.sale_item_transaction
  ADD CONSTRAINT fk_sale_item_transaction_item
  FOREIGN KEY (item_id) REFERENCES core.item(id);

CREATE UNIQUE INDEX uq_sale_item_transaction_sale_product_item
  ON core.sale_item_transaction(sale_id, product_id, item_id);
