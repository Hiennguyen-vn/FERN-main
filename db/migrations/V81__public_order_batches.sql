-- V81: QR/public table order batches.
--
-- A QR submission is a request batch, not a sale. Staff approves a batch, then
-- approved items are appended to the table's active sale_record (open check).

CREATE TABLE IF NOT EXISTS core.public_order_batch (
  id                  BIGINT PRIMARY KEY,
  outlet_id           BIGINT NOT NULL REFERENCES core.outlet(id),
  ordering_table_id   BIGINT NOT NULL REFERENCES core.ordering_table(id),
  sale_id             BIGINT,
  order_token         TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at         TIMESTAMPTZ,
  approved_by         BIGINT,
  rejected_at         TIMESTAMPTZ,
  rejected_by         BIGINT,
  rejection_reason    TEXT
);

CREATE TABLE IF NOT EXISTS core.public_order_batch_item (
  id                  BIGSERIAL PRIMARY KEY,
  batch_id            BIGINT NOT NULL REFERENCES core.public_order_batch(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES core.product(id),
  qty                 NUMERIC(18,4) NOT NULL CHECK (qty > 0),
  note                TEXT,
  unit_price          NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount          NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total          NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_order_batch_outlet_status
  ON core.public_order_batch(outlet_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_order_batch_table_status
  ON core.public_order_batch(ordering_table_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_order_batch_sale
  ON core.public_order_batch(sale_id)
  WHERE sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_public_order_batch_item_batch
  ON core.public_order_batch_item(batch_id);

CREATE INDEX IF NOT EXISTS idx_sale_record_active_table_check
  ON core.sale_record(ordering_table_id, payment_status, status, created_at DESC)
  WHERE ordering_table_id IS NOT NULL
    AND payment_status = 'unpaid'::core.payment_status_enum
    AND status = 'order_approved'::core.sale_order_status_enum;

ALTER TABLE core.kitchen_ticket
  DROP CONSTRAINT IF EXISTS uq_kitchen_ticket_sale;

CREATE INDEX IF NOT EXISTS ix_kitchen_ticket_sale
  ON core.kitchen_ticket(sale_id);
