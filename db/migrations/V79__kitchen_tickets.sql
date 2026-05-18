-- V79: Kitchen Display System (KDS) — ticket workflow tables.
--
-- Kitchen ticket is a snapshot view of a sale_record for kitchen staff. Items
-- snapshot product name/qty/modifiers/allergens at create time so KDS doesn't
-- depend on product-service runtime joins and so historic tickets stay
-- readable even when products are renamed or retired.
--
-- No FK to core.sale_record / core.sale_item because both are partitioned by
-- created_at with composite PKs — adding cross-partition FKs adds churn for
-- little safety. We rely on the application layer to only create tickets for
-- valid sale ids.

CREATE TABLE core.kitchen_ticket (
  id                BIGSERIAL PRIMARY KEY,
  sale_id           BIGINT      NOT NULL,
  outlet_id         BIGINT      NOT NULL REFERENCES core.outlet(id),
  ordering_table_id BIGINT,
  ordering_table_code TEXT,
  ordering_table_name TEXT,
  order_type        TEXT,
  status            TEXT        NOT NULL CHECK (status IN ('new','in_progress','ready','served','cancelled')),
  prep_sla_seconds  INT         NOT NULL DEFAULT 900,
  notes             TEXT,
  sla_breached_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  ready_at          TIMESTAMPTZ,
  served_at         TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_kitchen_ticket_sale UNIQUE (sale_id)
);

CREATE INDEX ix_kitchen_ticket_outlet_status
  ON core.kitchen_ticket(outlet_id, status)
  WHERE status IN ('new','in_progress','ready');

CREATE INDEX ix_kitchen_ticket_outlet_created
  ON core.kitchen_ticket(outlet_id, created_at);

CREATE TABLE core.kitchen_ticket_item (
  id            BIGSERIAL   PRIMARY KEY,
  ticket_id     BIGINT      NOT NULL REFERENCES core.kitchen_ticket(id) ON DELETE CASCADE,
  product_id    BIGINT      NOT NULL,
  product_name  TEXT        NOT NULL,
  qty           NUMERIC(18,4) NOT NULL CHECK (qty > 0),
  status        TEXT        NOT NULL CHECK (status IN ('new','preparing','ready','served','cancelled')),
  modifiers     JSONB,
  allergens     TEXT[],
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  ready_at      TIMESTAMPTZ,
  served_at     TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_kitchen_ticket_item_ticket ON core.kitchen_ticket_item(ticket_id);
CREATE INDEX ix_kitchen_ticket_item_status ON core.kitchen_ticket_item(ticket_id, status);

-- Permissions
INSERT INTO core.permission (code, name, description) VALUES
  ('kitchen.read',  'Kitchen Read',  'View kitchen tickets at assigned outlet'),
  ('kitchen.write', 'Kitchen Write', 'Advance kitchen ticket / item status')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  deleted_at = NULL,
  updated_at = NOW();

INSERT INTO core.role_permission (role_code, permission_code) VALUES
  ('kitchen_staff',  'kitchen.read'),
  ('kitchen_staff',  'kitchen.write'),
  ('outlet_manager', 'kitchen.read'),
  ('outlet_manager', 'kitchen.write'),
  ('staff',          'kitchen.read'),
  ('cashier',        'kitchen.read'),
  ('admin',          'kitchen.read'),
  ('admin',          'kitchen.write'),
  ('superadmin',     'kitchen.read'),
  ('superadmin',     'kitchen.write')
ON CONFLICT (role_code, permission_code) DO NOTHING;
