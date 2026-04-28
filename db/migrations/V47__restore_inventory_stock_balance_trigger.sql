DROP TRIGGER IF EXISTS trg_inventory_transaction_sync_stock_balance ON core.inventory_transaction;

CREATE TRIGGER trg_inventory_transaction_sync_stock_balance
AFTER INSERT ON core.inventory_transaction
FOR EACH ROW EXECUTE FUNCTION core.sync_stock_balance();
