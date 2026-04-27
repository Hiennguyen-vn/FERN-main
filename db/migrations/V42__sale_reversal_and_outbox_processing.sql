ALTER TABLE core.inventory_transaction
  DROP CONSTRAINT IF EXISTS chk_inventory_txn_sign;
ALTER TABLE core.inventory_transaction
  ADD CONSTRAINT chk_inventory_txn_sign CHECK (
    CASE
      WHEN txn_type IN ('purchase_in','stock_adjustment_in','manufacture_in','sale_reversal')
        THEN qty_change > 0
      WHEN txn_type IN ('sale_usage','waste_out','stock_adjustment_out','manufacture_out')
        THEN qty_change < 0
    END
  );

CREATE TABLE IF NOT EXISTS core.sale_inventory_reversal (
  sale_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL REFERENCES core.item(id),
  original_inventory_transaction_id BIGINT NOT NULL,
  original_inventory_txn_time TIMESTAMPTZ NOT NULL,
  reversal_inventory_transaction_id BIGINT NOT NULL,
  reversal_inventory_txn_time TIMESTAMPTZ NOT NULL,
  reversed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE core.sale_inventory_reversal
  ADD CONSTRAINT sale_inventory_reversal_pkey
  PRIMARY KEY (original_inventory_transaction_id, original_inventory_txn_time);
ALTER TABLE core.sale_inventory_reversal
  ADD CONSTRAINT sale_inventory_reversal_original_fkey
  FOREIGN KEY (original_inventory_transaction_id, original_inventory_txn_time)
  REFERENCES core.inventory_transaction(id, txn_time);
ALTER TABLE core.sale_inventory_reversal
  ADD CONSTRAINT sale_inventory_reversal_reversal_unique
  UNIQUE (reversal_inventory_transaction_id, reversal_inventory_txn_time);
ALTER TABLE core.sale_inventory_reversal
  ADD CONSTRAINT sale_inventory_reversal_reversal_fkey
  FOREIGN KEY (reversal_inventory_transaction_id, reversal_inventory_txn_time)
  REFERENCES core.inventory_transaction(id, txn_time);

ALTER TABLE core.outbox_event
  DROP CONSTRAINT IF EXISTS outbox_event_status_check;
ALTER TABLE core.outbox_event
  ADD CONSTRAINT outbox_event_status_check CHECK (status IN ('PENDING','PROCESSING','PUBLISHED','FAILED'));
ALTER TABLE core.outbox_event
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_owner TEXT;
CREATE INDEX IF NOT EXISTS ix_outbox_processing_reclaim
  ON core.outbox_event (status, processing_started_at)
  WHERE status = 'PROCESSING';
