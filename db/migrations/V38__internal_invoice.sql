-- Add tax_code to outlet for invoice seller info
ALTER TABLE core.outlet ADD COLUMN IF NOT EXISTS tax_code TEXT;

-- Finance schema for invoice tracking
CREATE SCHEMA IF NOT EXISTS finance;

-- Atomic serial per outlet per calendar year
CREATE TABLE IF NOT EXISTS finance.outlet_invoice_sequence (
  outlet_id   BIGINT   NOT NULL,
  year        SMALLINT NOT NULL,
  next_serial BIGINT   NOT NULL DEFAULT 1,
  PRIMARY KEY (outlet_id, year)
);

CREATE TABLE IF NOT EXISTS finance.invoice (
  id               BIGINT        PRIMARY KEY,
  outlet_id        BIGINT        NOT NULL,
  sale_id          BIGINT        NOT NULL UNIQUE,
  invoice_number   TEXT          NOT NULL,
  invoice_year     SMALLINT      NOT NULL,
  invoice_serial   BIGINT        NOT NULL,
  issued_at        TIMESTAMPTZ   NOT NULL,
  -- Seller snapshot from outlet at issue time
  seller_tax_code  TEXT,
  seller_name      TEXT          NOT NULL,
  seller_address   TEXT,
  -- Buyer (walk-in F&B = NULL)
  buyer_name       TEXT,
  buyer_phone      TEXT,
  -- Amounts in cents (VND * 100)
  subtotal_cents   BIGINT        NOT NULL,
  vat_cents        BIGINT        NOT NULL,
  total_cents      BIGINT        NOT NULL,
  total_in_words   TEXT          NOT NULL,
  payment_method   TEXT          NOT NULL,
  currency         TEXT          NOT NULL DEFAULT 'VND',
  cqt_status       TEXT          NOT NULL DEFAULT 'internal_only',
  template_version TEXT          NOT NULL DEFAULT 'v1',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, invoice_year, invoice_serial)
);

CREATE TABLE IF NOT EXISTS finance.invoice_line (
  id               BIGSERIAL     PRIMARY KEY,
  invoice_id       BIGINT        NOT NULL REFERENCES finance.invoice(id),
  line_no          INT           NOT NULL,
  product_code     TEXT          NOT NULL,
  product_name     TEXT          NOT NULL,
  unit             TEXT          NOT NULL DEFAULT 'phần',
  qty              NUMERIC(18,3) NOT NULL,
  unit_price_cents BIGINT        NOT NULL,
  discount_cents   BIGINT        NOT NULL DEFAULT 0,
  vat_percent      NUMERIC(5,2)  NOT NULL DEFAULT 8.00,
  vat_cents        BIGINT        NOT NULL,
  amount_cents     BIGINT        NOT NULL,
  UNIQUE (invoice_id, line_no)
);
