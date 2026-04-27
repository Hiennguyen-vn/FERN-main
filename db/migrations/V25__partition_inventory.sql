-- Partition inventory_transaction by txn_time (monthly).
-- V22 already made the table append-only (no UPDATE/DELETE).
-- Strategy: rename legacy, create partitioned parent, backfill, drop legacy.

BEGIN;

-- ─── 1. Rename legacy ─────────────────────────────────────────────────────────

ALTER TABLE core.inventory_transaction RENAME TO inventory_transaction_legacy;

-- Drop dependent child tables' FKs temporarily; they reference by PK (id).
-- Child tables: waste_record, goods_receipt_transaction, sale_item_transaction,
--              manufacturing_transaction — these FK on inventory_transaction_id.
-- We'll recreate FKs after partition parent is established.

ALTER TABLE core.waste_record
  DROP CONSTRAINT waste_record_pkey CASCADE;
ALTER TABLE core.goods_receipt_transaction
  DROP CONSTRAINT goods_receipt_transaction_pkey CASCADE;
ALTER TABLE core.sale_item_transaction
  DROP CONSTRAINT sale_item_transaction_pkey CASCADE;
ALTER TABLE core.manufacturing_transaction
  DROP CONSTRAINT manufacturing_transaction_pkey CASCADE;

-- ─── 2. Create partitioned inventory_transaction ──────────────────────────────

CREATE TABLE core.inventory_transaction (
  id                  BIGINT        NOT NULL,
  outlet_id           BIGINT        NOT NULL REFERENCES core.outlet(id),
  item_id             BIGINT        NOT NULL REFERENCES core.item(id),
  qty_change          NUMERIC(18,4) NOT NULL,
  CONSTRAINT chk_inventory_txn_sign CHECK (
    CASE
      WHEN txn_type IN ('purchase_in','stock_adjustment_in','manufacture_in')
        THEN qty_change > 0
      WHEN txn_type IN ('sale_usage','waste_out','stock_adjustment_out','manufacture_out')
        THEN qty_change < 0
    END
  ),
  business_date       DATE          NOT NULL,
  txn_time            TIMESTAMPTZ   NOT NULL,
  txn_type            core.inventory_txn_type_enum NOT NULL,
  unit_cost           NUMERIC(18,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  created_by_user_id  BIGINT        REFERENCES core.app_user(id) ON DELETE SET NULL,
  note                TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, txn_time)
) PARTITION BY RANGE (txn_time);

-- Past partitions
CREATE TABLE core.inventory_transaction_2025_01 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE core.inventory_transaction_2025_02 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE core.inventory_transaction_2025_03 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE core.inventory_transaction_2025_04 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE core.inventory_transaction_2025_05 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE core.inventory_transaction_2025_06 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE core.inventory_transaction_2025_07 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE core.inventory_transaction_2025_08 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE core.inventory_transaction_2025_09 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE core.inventory_transaction_2025_10 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE core.inventory_transaction_2025_11 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE core.inventory_transaction_2025_12 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
-- Current + future
CREATE TABLE core.inventory_transaction_2026_01 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE core.inventory_transaction_2026_02 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE core.inventory_transaction_2026_03 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE core.inventory_transaction_2026_04 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE core.inventory_transaction_2026_05 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE core.inventory_transaction_2026_06 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE core.inventory_transaction_2026_07 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE core.inventory_transaction_2026_08 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE core.inventory_transaction_2026_09 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE core.inventory_transaction_2026_10 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE core.inventory_transaction_2026_11 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE core.inventory_transaction_2026_12 PARTITION OF core.inventory_transaction
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE core.inventory_transaction_default PARTITION OF core.inventory_transaction DEFAULT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_transaction_outlet_id
  ON core.inventory_transaction(outlet_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transaction_item_id
  ON core.inventory_transaction(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transaction_business_date
  ON core.inventory_transaction(business_date);
CREATE INDEX IF NOT EXISTS idx_inventory_transaction_txn_type
  ON core.inventory_transaction(txn_type);
CREATE INDEX IF NOT EXISTS idx_inventory_transaction_outlet_item_time
  ON core.inventory_transaction(outlet_id, item_id, txn_time);

-- Reattach immutable trigger (V22 recreated it on old table name, so reapply)
CREATE OR REPLACE FUNCTION prevent_inventory_transaction_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transaction is append-only; use compensating entry';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transaction_immutable
  BEFORE UPDATE OR DELETE ON core.inventory_transaction
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_transaction_mutation();

-- ─── 3. Backfill ─────────────────────────────────────────────────────────────

INSERT INTO core.inventory_transaction
SELECT id, outlet_id, item_id, qty_change, business_date, txn_time, txn_type,
       unit_cost, created_by_user_id, note, created_at
FROM core.inventory_transaction_legacy;

-- ─── 4. Restore child table PKs and FKs ──────────────────────────────────────
-- Child tables now FK on (inventory_transaction_id, txn_time) composite.
-- Add txn_time denorm column to each child first.

ALTER TABLE core.waste_record
  ADD COLUMN txn_time TIMESTAMPTZ;
UPDATE core.waste_record wr
  SET txn_time = it.txn_time
  FROM core.inventory_transaction it
  WHERE it.id = wr.inventory_transaction_id;
ALTER TABLE core.waste_record ALTER COLUMN txn_time SET NOT NULL;
ALTER TABLE core.waste_record
  ADD PRIMARY KEY (inventory_transaction_id, txn_time);
ALTER TABLE core.waste_record
  ADD CONSTRAINT fk_waste_record_txn
    FOREIGN KEY (inventory_transaction_id, txn_time)
    REFERENCES core.inventory_transaction(id, txn_time) ON DELETE CASCADE;

ALTER TABLE core.goods_receipt_transaction
  ADD COLUMN txn_time TIMESTAMPTZ;
UPDATE core.goods_receipt_transaction grt
  SET txn_time = it.txn_time
  FROM core.inventory_transaction it
  WHERE it.id = grt.inventory_transaction_id;
ALTER TABLE core.goods_receipt_transaction ALTER COLUMN txn_time SET NOT NULL;
ALTER TABLE core.goods_receipt_transaction
  ADD PRIMARY KEY (inventory_transaction_id, txn_time);
ALTER TABLE core.goods_receipt_transaction
  ADD CONSTRAINT fk_goods_receipt_txn
    FOREIGN KEY (inventory_transaction_id, txn_time)
    REFERENCES core.inventory_transaction(id, txn_time) ON DELETE CASCADE;

ALTER TABLE core.sale_item_transaction
  ADD COLUMN txn_time TIMESTAMPTZ;
UPDATE core.sale_item_transaction sit
  SET txn_time = it.txn_time
  FROM core.inventory_transaction it
  WHERE it.id = sit.inventory_transaction_id;
ALTER TABLE core.sale_item_transaction ALTER COLUMN txn_time SET NOT NULL;
ALTER TABLE core.sale_item_transaction
  ADD PRIMARY KEY (inventory_transaction_id, txn_time);
ALTER TABLE core.sale_item_transaction
  ADD CONSTRAINT fk_sale_item_txn
    FOREIGN KEY (inventory_transaction_id, txn_time)
    REFERENCES core.inventory_transaction(id, txn_time) ON DELETE CASCADE;

ALTER TABLE core.manufacturing_transaction
  ADD COLUMN txn_time TIMESTAMPTZ;
UPDATE core.manufacturing_transaction mt
  SET txn_time = it.txn_time
  FROM core.inventory_transaction it
  WHERE it.id = mt.inventory_transaction_id;
ALTER TABLE core.manufacturing_transaction ALTER COLUMN txn_time SET NOT NULL;
ALTER TABLE core.manufacturing_transaction
  ADD PRIMARY KEY (inventory_transaction_id, txn_time);
ALTER TABLE core.manufacturing_transaction
  ADD CONSTRAINT fk_manufacturing_txn
    FOREIGN KEY (inventory_transaction_id, txn_time)
    REFERENCES core.inventory_transaction(id, txn_time) ON DELETE CASCADE;

-- ─── 5. Drop legacy ───────────────────────────────────────────────────────────
-- Drop remaining FKs pointing to legacy table before dropping it
ALTER TABLE core.waste_record               DROP CONSTRAINT IF EXISTS waste_record_inventory_transaction_id_fkey;
ALTER TABLE core.goods_receipt_transaction  DROP CONSTRAINT IF EXISTS goods_receipt_transaction_inventory_transaction_id_fkey;
ALTER TABLE core.sale_item_transaction      DROP CONSTRAINT IF EXISTS sale_item_transaction_inventory_transaction_id_fkey;
ALTER TABLE core.manufacturing_transaction  DROP CONSTRAINT IF EXISTS manufacturing_transaction_inventory_transaction_id_fkey;
ALTER TABLE core.inventory_adjustment       DROP CONSTRAINT IF EXISTS inventory_adjustment_inventory_transaction_id_fkey;
DROP TABLE core.inventory_transaction_legacy;

COMMIT;
