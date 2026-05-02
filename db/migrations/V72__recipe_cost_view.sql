-- V72: Recipe BOM cost rollup + food-cost % view.
-- theoretical_cost = SUM(recipe_item.qty * latest_unit_cost(item))
-- Latest cost = stock_balance.unit_cost (weighted avg) when present, else 0.

CREATE OR REPLACE VIEW core.v_recipe_cost AS
WITH ingredient_cost AS (
  SELECT
    ri.product_id,
    ri.version,
    ri.item_id,
    ri.qty,
    COALESCE(MAX(sb.unit_cost), 0) AS unit_cost
  FROM core.recipe_item ri
  LEFT JOIN core.stock_balance sb ON sb.item_id = ri.item_id
  GROUP BY ri.product_id, ri.version, ri.item_id, ri.qty
)
SELECT
  ic.product_id,
  ic.version,
  SUM(ic.qty * ic.unit_cost)                                                 AS theoretical_cost,
  COALESCE((SELECT yield_qty FROM core.recipe r
            WHERE r.product_id = ic.product_id AND r.version = ic.version), 1) AS yield_qty,
  CASE WHEN COALESCE((SELECT yield_qty FROM core.recipe r
                      WHERE r.product_id = ic.product_id AND r.version = ic.version), 0) > 0
    THEN SUM(ic.qty * ic.unit_cost) /
         (SELECT yield_qty FROM core.recipe r
          WHERE r.product_id = ic.product_id AND r.version = ic.version)
    ELSE NULL
  END AS cost_per_yield_unit
FROM ingredient_cost ic
GROUP BY ic.product_id, ic.version;

-- Food cost % view: matches each product's active recipe with latest sell price.
-- Approximate sell price = max effective product_price across outlets (caller can refine per outlet).
CREATE OR REPLACE VIEW core.v_food_cost AS
SELECT
  rc.product_id,
  rc.version,
  rc.theoretical_cost,
  rc.cost_per_yield_unit,
  pp.price                                                                   AS sell_price,
  CASE WHEN pp.price > 0
    THEN (rc.cost_per_yield_unit / pp.price) * 100
    ELSE NULL
  END                                                                        AS food_cost_percent
FROM core.v_recipe_cost rc
LEFT JOIN LATERAL (
  SELECT price_value AS price
  FROM core.product_price pp2
  WHERE pp2.product_id = rc.product_id
    AND pp2.effective_from <= CURRENT_DATE
    AND (pp2.effective_to IS NULL OR pp2.effective_to > CURRENT_DATE)
  ORDER BY pp2.effective_from DESC
  LIMIT 1
) pp ON TRUE;

GRANT SELECT ON core.v_recipe_cost, core.v_food_cost TO fern_app;
