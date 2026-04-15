/* =========================================================
   V13 — Catalog Phase 3: Menu, Channel, Daypart, Scope Override
   ========================================================= */

-- ── Reference tables ─────────────────────────────────────

CREATE TABLE core.channel (
  code VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO core.channel (code, name, display_order) VALUES
  ('dine_in', 'Dine-in', 1),
  ('takeaway', 'Takeaway', 2),
  ('delivery', 'Delivery', 3),
  ('online', 'Online', 4)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE core.daypart (
  code VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO core.daypart (code, name, start_time, end_time, display_order) VALUES
  ('breakfast', 'Breakfast', '06:00', '10:30', 1),
  ('lunch', 'Lunch', '10:30', '14:00', 2),
  ('afternoon', 'Afternoon', '14:00', '17:00', 3),
  ('dinner', 'Dinner', '17:00', '21:00', 4),
  ('late_night', 'Late Night', '21:00', '06:00', 5)
ON CONFLICT (code) DO NOTHING;

-- ── Menu entity ──────────────────────────────────────────

CREATE TABLE core.menu (
  id BIGINT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'inactive')),
  scope_type VARCHAR(20) NOT NULL DEFAULT 'corporate'
    CHECK (scope_type IN ('corporate', 'region', 'outlet')),
  scope_id BIGINT,
  created_by_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_menu_status ON core.menu (status);
CREATE INDEX idx_menu_scope ON core.menu (scope_type, scope_id);

CREATE TABLE core.menu_category (
  id BIGINT PRIMARY KEY,
  menu_id BIGINT NOT NULL REFERENCES core.menu(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_menu_category UNIQUE (menu_id, code)
);

CREATE INDEX idx_menu_category_menu ON core.menu_category (menu_id);

CREATE TABLE core.menu_item (
  id BIGINT PRIMARY KEY,
  menu_category_id BIGINT NOT NULL REFERENCES core.menu_category(id),
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_menu_item UNIQUE (menu_category_id, product_id)
);

CREATE INDEX idx_menu_item_category ON core.menu_item (menu_category_id);
CREATE INDEX idx_menu_item_product ON core.menu_item (product_id);

-- Outlet-level menu exclusion (outlet can exclude items from inherited menu)
CREATE TABLE core.menu_item_exclusion (
  menu_item_id BIGINT NOT NULL REFERENCES core.menu_item(id),
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  reason VARCHAR(100),
  excluded_by_user_id BIGINT,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (menu_item_id, outlet_id)
);

-- ── Scope override (cross-cutting) ──────────────────────

CREATE TABLE core.catalog_override (
  id BIGINT PRIMARY KEY,
  entity_type VARCHAR(30) NOT NULL
    CHECK (entity_type IN ('price', 'recipe', 'availability', 'menu_exclusion')),
  entity_id BIGINT NOT NULL,
  field_name VARCHAR(50) NOT NULL,
  scope_type VARCHAR(20) NOT NULL
    CHECK (scope_type IN ('corporate', 'region', 'outlet', 'channel', 'daypart')),
  scope_id VARCHAR(50) NOT NULL,
  override_value TEXT NOT NULL,
  base_value TEXT,
  overridden_by_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_catalog_override UNIQUE (entity_type, entity_id, field_name, scope_type, scope_id)
);

CREATE INDEX idx_catalog_override_entity ON core.catalog_override (entity_type, entity_id);
CREATE INDEX idx_catalog_override_scope ON core.catalog_override (scope_type, scope_id);
