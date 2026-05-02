-- V73: add batch_no to goods_receipt_item for FIFO lot tracking via core.stock_lot.
ALTER TABLE core.goods_receipt_item
  ADD COLUMN IF NOT EXISTS batch_no TEXT;

CREATE INDEX IF NOT EXISTS idx_goods_receipt_item_batch_no
  ON core.goods_receipt_item(batch_no)
  WHERE batch_no IS NOT NULL;
