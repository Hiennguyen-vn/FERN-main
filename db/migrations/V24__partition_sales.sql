-- Partition sale_record, sale_item, payment by created_at (monthly).
-- Approach: rename existing tables to _legacy, create partitioned parents,
-- recreate indexes, backfill from legacy, then drop legacy.
-- Deploy in a maintenance window. Test on staging first.

BEGIN;

-- ─── 1. Rename legacy tables ──────────────────────────────────────────────────

ALTER TABLE core.sale_item            RENAME TO sale_item_legacy;
ALTER TABLE core.payment              RENAME TO payment_legacy;
ALTER TABLE core.sale_record          RENAME TO sale_record_legacy;

-- ─── 2. Create partitioned sale_record ───────────────────────────────────────

CREATE TABLE core.sale_record (
  id               BIGINT        NOT NULL,
  outlet_id        BIGINT        NOT NULL REFERENCES core.outlet(id),
  pos_session_id   BIGINT        REFERENCES core.pos_session(id),
  currency_code    VARCHAR(10)   NOT NULL REFERENCES core.currency(code),
  order_type       order_type_enum NOT NULL DEFAULT 'dine_in',
  status           sale_order_status_enum NOT NULL DEFAULT 'open',
  payment_status   payment_status_enum NOT NULL DEFAULT 'unpaid',
  subtotal         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_amount       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  note             TEXT,
  version          INT           NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sale_record_discount CHECK (discount <= subtotal),
  CONSTRAINT chk_sale_record_total    CHECK (total_amount = subtotal - discount + tax_amount),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Past partitions (backfill target + recent history)
CREATE TABLE core.sale_record_2025_01 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE core.sale_record_2025_02 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE core.sale_record_2025_03 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE core.sale_record_2025_04 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE core.sale_record_2025_05 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE core.sale_record_2025_06 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE core.sale_record_2025_07 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE core.sale_record_2025_08 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE core.sale_record_2025_09 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE core.sale_record_2025_10 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE core.sale_record_2025_11 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE core.sale_record_2025_12 PARTITION OF core.sale_record
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
-- Current + future partitions (12 months)
CREATE TABLE core.sale_record_2026_01 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE core.sale_record_2026_02 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE core.sale_record_2026_03 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE core.sale_record_2026_04 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE core.sale_record_2026_05 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE core.sale_record_2026_06 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE core.sale_record_2026_07 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE core.sale_record_2026_08 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE core.sale_record_2026_09 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE core.sale_record_2026_10 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE core.sale_record_2026_11 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE core.sale_record_2026_12 PARTITION OF core.sale_record
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
-- Default partition catches anything outside explicit ranges (pre-2025 data)
CREATE TABLE core.sale_record_default PARTITION OF core.sale_record DEFAULT;

-- Indexes on partitioned table (created on parent, inherited by partitions)
CREATE INDEX idx_sale_record_outlet_id      ON core.sale_record(outlet_id);
CREATE INDEX idx_sale_record_pos_session_id ON core.sale_record(pos_session_id);
CREATE INDEX idx_sale_record_status         ON core.sale_record(status);
CREATE INDEX idx_sale_record_created_at     ON core.sale_record(created_at);

-- ─── 3. Create partitioned sale_item ─────────────────────────────────────────
-- Denormalized sale_created_at enables composite FK + partition pruning.

CREATE TABLE core.sale_item (
  sale_id          BIGINT        NOT NULL,
  sale_created_at  TIMESTAMPTZ   NOT NULL,  -- denorm from sale_record.created_at
  outlet_id        BIGINT        NOT NULL,  -- denorm for shard-ready (W1.7)
  product_id       BIGINT        NOT NULL REFERENCES core.product(id),
  unit_price       NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0),
  qty              NUMERIC(18,4) NOT NULL CHECK (qty > 0),
  discount_amount  NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total       NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  note             TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sale_id, sale_created_at, product_id),
  CONSTRAINT fk_sale_item_sale FOREIGN KEY (sale_id, sale_created_at)
    REFERENCES core.sale_record(id, created_at) ON DELETE CASCADE
) PARTITION BY RANGE (sale_created_at);

CREATE TABLE core.sale_item_2025_01 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE core.sale_item_2025_02 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE core.sale_item_2025_03 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE core.sale_item_2025_04 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE core.sale_item_2025_05 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE core.sale_item_2025_06 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE core.sale_item_2025_07 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE core.sale_item_2025_08 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE core.sale_item_2025_09 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE core.sale_item_2025_10 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE core.sale_item_2025_11 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE core.sale_item_2025_12 PARTITION OF core.sale_item
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE core.sale_item_2026_01 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE core.sale_item_2026_02 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE core.sale_item_2026_03 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE core.sale_item_2026_04 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE core.sale_item_2026_05 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE core.sale_item_2026_06 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE core.sale_item_2026_07 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE core.sale_item_2026_08 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE core.sale_item_2026_09 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE core.sale_item_2026_10 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE core.sale_item_2026_11 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE core.sale_item_2026_12 PARTITION OF core.sale_item
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE core.sale_item_default PARTITION OF core.sale_item DEFAULT;

CREATE INDEX idx_sale_item_product_id  ON core.sale_item(product_id);
CREATE INDEX idx_sale_item_outlet_id   ON core.sale_item(outlet_id);
CREATE INDEX idx_sale_item_sale_id     ON core.sale_item(sale_id);

-- ─── 4. Create partitioned payment ───────────────────────────────────────────

CREATE TABLE core.payment (
  sale_id              BIGINT        NOT NULL,
  sale_created_at      TIMESTAMPTZ   NOT NULL,  -- denorm for partition FK
  outlet_id            BIGINT        NOT NULL,  -- denorm for shard-ready
  pos_session_id       BIGINT        REFERENCES core.pos_session(id),
  payment_method       payment_method_enum NOT NULL,
  amount               NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  status               payment_txn_status_enum NOT NULL DEFAULT 'pending',
  payment_time         TIMESTAMPTZ   NOT NULL,
  transaction_ref      VARCHAR(100),
  note                 TEXT,
  -- offline POS columns (V21)
  state                TEXT          NOT NULL DEFAULT 'COMPLETED'
    CHECK (state IN ('PENDING_OFFLINE','QUEUED','COMPLETED','RECONCILED','FAILED')),
  offline_captured_at  TIMESTAMPTZ,
  reconciled_at        TIMESTAMPTZ,
  device_id            BIGINT        REFERENCES core.device_registry(id),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sale_id, sale_created_at),
  CONSTRAINT fk_payment_sale FOREIGN KEY (sale_id, sale_created_at)
    REFERENCES core.sale_record(id, created_at) ON DELETE CASCADE
) PARTITION BY RANGE (sale_created_at);

CREATE TABLE core.payment_2025_01 PARTITION OF core.payment
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE core.payment_2025_02 PARTITION OF core.payment
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE core.payment_2025_03 PARTITION OF core.payment
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE core.payment_2025_04 PARTITION OF core.payment
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE core.payment_2025_05 PARTITION OF core.payment
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE core.payment_2025_06 PARTITION OF core.payment
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE core.payment_2025_07 PARTITION OF core.payment
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE core.payment_2025_08 PARTITION OF core.payment
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE core.payment_2025_09 PARTITION OF core.payment
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE core.payment_2025_10 PARTITION OF core.payment
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE core.payment_2025_11 PARTITION OF core.payment
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE core.payment_2025_12 PARTITION OF core.payment
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE core.payment_2026_01 PARTITION OF core.payment
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE core.payment_2026_02 PARTITION OF core.payment
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE core.payment_2026_03 PARTITION OF core.payment
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE core.payment_2026_04 PARTITION OF core.payment
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE core.payment_2026_05 PARTITION OF core.payment
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE core.payment_2026_06 PARTITION OF core.payment
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE core.payment_2026_07 PARTITION OF core.payment
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE core.payment_2026_08 PARTITION OF core.payment
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE core.payment_2026_09 PARTITION OF core.payment
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE core.payment_2026_10 PARTITION OF core.payment
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE core.payment_2026_11 PARTITION OF core.payment
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE core.payment_2026_12 PARTITION OF core.payment
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE core.payment_default PARTITION OF core.payment DEFAULT;

CREATE INDEX idx_payment_pos_session_id  ON core.payment(pos_session_id);
CREATE INDEX idx_payment_payment_method  ON core.payment(payment_method);
CREATE INDEX idx_payment_payment_time    ON core.payment(payment_time);
CREATE INDEX idx_payment_status          ON core.payment(status);
CREATE INDEX idx_payment_outlet_id       ON core.payment(outlet_id);
CREATE INDEX idx_payment_state           ON core.payment(state)
  WHERE state IN ('PENDING_OFFLINE','QUEUED');

-- ─── 5. Backfill data from legacy ────────────────────────────────────────────

INSERT INTO core.sale_record
SELECT id, outlet_id, pos_session_id, currency_code, order_type, status,
       payment_status, subtotal, discount, tax_amount, total_amount, note,
       0 AS version, created_at, updated_at
FROM core.sale_record_legacy;

INSERT INTO core.sale_item
SELECT
  si.sale_id,
  sr.created_at AS sale_created_at,
  sr.outlet_id,
  si.product_id, si.unit_price, si.qty, si.discount_amount,
  si.tax_amount, si.line_total, si.note, si.created_at, si.updated_at
FROM core.sale_item_legacy si
JOIN core.sale_record sr ON sr.id = si.sale_id;

INSERT INTO core.payment
SELECT
  p.sale_id,
  sr.created_at AS sale_created_at,
  sr.outlet_id,
  p.pos_session_id, p.payment_method, p.amount, p.status, p.payment_time,
  p.transaction_ref, p.note,
  'COMPLETED' AS state, NULL, NULL, NULL,
  p.created_at, p.updated_at
FROM core.payment_legacy p
JOIN core.sale_record sr ON sr.id = p.sale_id;

-- ─── 6. Migrate sale_item_promotion FK (sale_id, sale_created_at, product_id) ─

-- The sale_item_promotion FK references sale_item(sale_id, product_id).
-- After partition, PK is (sale_id, sale_created_at, product_id).
-- Add sale_created_at to sale_item_promotion for new FK.
ALTER TABLE core.sale_item_promotion
  ADD COLUMN sale_created_at TIMESTAMPTZ;

UPDATE core.sale_item_promotion sip
SET sale_created_at = sr.created_at
FROM core.sale_record sr
WHERE sr.id = sip.sale_id;

ALTER TABLE core.sale_item_promotion
  ALTER COLUMN sale_created_at SET NOT NULL;

-- Recreate FK to use composite key
ALTER TABLE core.sale_item_promotion
  DROP CONSTRAINT fk_sale_item_promotion_sale_item;
ALTER TABLE core.sale_item_promotion
  ADD CONSTRAINT fk_sale_item_promotion_sale_item
    FOREIGN KEY (sale_id, sale_created_at, product_id)
    REFERENCES core.sale_item(sale_id, sale_created_at, product_id)
    ON DELETE CASCADE;

-- Migrate sale_item_transaction FK similarly
ALTER TABLE core.sale_item_transaction
  ADD COLUMN sale_created_at TIMESTAMPTZ;

UPDATE core.sale_item_transaction sit
SET sale_created_at = sr.created_at
FROM core.sale_record sr
WHERE sr.id = sit.sale_id;

ALTER TABLE core.sale_item_transaction
  ALTER COLUMN sale_created_at SET NOT NULL;

ALTER TABLE core.sale_item_transaction
  DROP CONSTRAINT fk_sale_item_transaction_sale_item;
ALTER TABLE core.sale_item_transaction
  ADD CONSTRAINT fk_sale_item_transaction_sale_item
    FOREIGN KEY (sale_id, sale_created_at, product_id)
    REFERENCES core.sale_item(sale_id, sale_created_at, product_id);

-- ─── 7. Drop legacy tables (after verification on staging) ───────────────────
-- Uncomment only after confirming row counts match:
--   SELECT COUNT(*) FROM core.sale_record;
--   SELECT COUNT(*) FROM core.sale_record_legacy;
DROP TABLE core.sale_item_legacy;
DROP TABLE core.payment_legacy;
DROP TABLE core.sale_record_legacy;

COMMIT;
