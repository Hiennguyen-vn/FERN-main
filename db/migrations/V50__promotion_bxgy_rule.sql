-- Buy-X-Get-Y promotion rule details.
--
-- Existing core.promotion table has promo_type + value_amount/percent which is
-- insufficient for B-X-G-Y mechanics (need X qty, Y qty, paid product, free product).
-- Add a 1:1 detail table keyed by promotion_id, populated only when promo_type='buy_x_get_y'.
--
-- Free product price is computed at evaluation time from the menu/sale_item; this table just
-- carries the rule mechanics.

CREATE TABLE IF NOT EXISTS core.promotion_bxgy_rule (
  promotion_id      BIGINT PRIMARY KEY REFERENCES core.promotion(id) ON DELETE CASCADE,
  buy_product_id    BIGINT NOT NULL REFERENCES core.product(id),
  buy_quantity      NUMERIC(18,4) NOT NULL CHECK (buy_quantity > 0),
  get_product_id    BIGINT NOT NULL REFERENCES core.product(id),
  get_quantity      NUMERIC(18,4) NOT NULL CHECK (get_quantity > 0),
  -- get_discount_percent: 100 = fully free, 50 = half off the get_product_id
  get_discount_percent NUMERIC(8,4) NOT NULL DEFAULT 100
    CHECK (get_discount_percent >= 0 AND get_discount_percent <= 100),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_bxgy_rule_buy_product
  ON core.promotion_bxgy_rule(buy_product_id);
CREATE INDEX IF NOT EXISTS idx_promotion_bxgy_rule_get_product
  ON core.promotion_bxgy_rule(get_product_id);
