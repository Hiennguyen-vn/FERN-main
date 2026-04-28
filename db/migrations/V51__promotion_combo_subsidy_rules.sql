-- Typed rule details for combo-price and subsidy promotions.
-- core.promotion keeps shared lifecycle/scope fields; rule tables carry mechanics
-- for promo_type values that cannot be represented by value_amount/value_percent alone.

CREATE TABLE IF NOT EXISTS core.promotion_combo_rule (
  promotion_id BIGINT PRIMARY KEY REFERENCES core.promotion(id) ON DELETE CASCADE,
  combo_price NUMERIC(18,2) NOT NULL CHECK (combo_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.promotion_combo_rule_item (
  promotion_id BIGINT NOT NULL REFERENCES core.promotion_combo_rule(promotion_id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (promotion_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_combo_rule_item_product
  ON core.promotion_combo_rule_item(product_id);

CREATE TABLE IF NOT EXISTS core.promotion_subsidy_rule (
  promotion_id BIGINT PRIMARY KEY REFERENCES core.promotion(id) ON DELETE CASCADE,
  scope_product_id BIGINT REFERENCES core.product(id),
  funding_source TEXT NOT NULL,
  funding_account_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_subsidy_rule_scope_product
  ON core.promotion_subsidy_rule(scope_product_id);
