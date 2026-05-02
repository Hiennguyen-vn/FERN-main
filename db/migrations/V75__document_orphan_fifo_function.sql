-- V75: Mark core.fn_deplete_stock_lot as orphaned helper.
-- Function defined in V71 but has zero callers in Java services.
-- Inventory depletion currently flows through core.inventory_transaction
-- (see InventoryRepository.applySaleApproved).
-- Keep function definition for future FIFO lot integration; flag via comment.

COMMENT ON FUNCTION core.fn_deplete_stock_lot(BIGINT, BIGINT, NUMERIC) IS
  'ORPHAN: Defined in V71, no Java callers as of V75. '
  'Inventory depletion uses core.inventory_transaction (sale_usage txn_type). '
  'Reactivate when lot-aware FIFO is wired into InventoryRepository.';
