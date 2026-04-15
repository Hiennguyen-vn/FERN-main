/* =========================================================
   V16 — Product Variants & Modifier Groups
   ========================================================= */

CREATE TABLE core.product_variant (
  id BIGINT PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  price_modifier_type VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (price_modifier_type IN ('none', 'fixed', 'percentage')),
  price_modifier_value NUMERIC(15,2) DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_variant UNIQUE (product_id, code)
);

CREATE INDEX idx_product_variant_product ON core.product_variant (product_id);

CREATE TABLE core.modifier_group (
  id BIGINT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  selection_type VARCHAR(20) NOT NULL DEFAULT 'single'
    CHECK (selection_type IN ('single', 'multiple')),
  min_selections INT NOT NULL DEFAULT 0,
  max_selections INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.modifier_option (
  id BIGINT PRIMARY KEY,
  modifier_group_id BIGINT NOT NULL REFERENCES core.modifier_group(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  price_adjustment NUMERIC(15,2) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_modifier_option UNIQUE (modifier_group_id, code)
);

CREATE INDEX idx_modifier_option_group ON core.modifier_option (modifier_group_id);

-- Link products to modifier groups
CREATE TABLE core.product_modifier_group (
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  modifier_group_id BIGINT NOT NULL REFERENCES core.modifier_group(id),
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, modifier_group_id)
);
