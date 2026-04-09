-- Backfill outlet/product coverage gaps that can break POS order pricing resolution.
-- This migration is intentionally conservative:
-- 1) ensure active product/outlet availability rows exist
-- 2) seed missing product_price histories only when a same-currency template exists
--    for that product elsewhere.

INSERT INTO core.product_outlet_availability (product_id, outlet_id, is_available)
SELECT
  p.id AS product_id,
  o.id AS outlet_id,
  TRUE AS is_available
FROM core.product p
JOIN core.outlet o ON o.deleted_at IS NULL
LEFT JOIN core.product_outlet_availability poa
  ON poa.product_id = p.id
 AND poa.outlet_id = o.id
WHERE p.deleted_at IS NULL
  AND p.status = 'active'
  AND o.status = 'active'
  AND poa.product_id IS NULL;

WITH outlet_currency AS (
  SELECT
    o.id AS outlet_id,
    r.currency_code
  FROM core.outlet o
  JOIN core.region r ON r.id = o.region_id
  WHERE o.deleted_at IS NULL
    AND o.status = 'active'
),
latest_price_template AS (
  SELECT DISTINCT ON (pp.product_id, pp.currency_code)
    pp.product_id,
    pp.currency_code,
    pp.price_value
  FROM core.product_price pp
  ORDER BY pp.product_id, pp.currency_code, pp.effective_from DESC, pp.updated_at DESC
),
missing_price_pairs AS (
  SELECT
    p.id AS product_id,
    oc.outlet_id,
    oc.currency_code
  FROM core.product p
  JOIN outlet_currency oc ON TRUE
  LEFT JOIN core.product_price existing
    ON existing.product_id = p.id
   AND existing.outlet_id = oc.outlet_id
  WHERE p.deleted_at IS NULL
    AND p.status = 'active'
    AND existing.product_id IS NULL
)
INSERT INTO core.product_price (
  product_id,
  outlet_id,
  currency_code,
  price_value,
  effective_from,
  effective_to
)
SELECT
  mp.product_id,
  mp.outlet_id,
  mp.currency_code,
  lpt.price_value,
  CURRENT_DATE AS effective_from,
  NULL::DATE AS effective_to
FROM missing_price_pairs mp
JOIN latest_price_template lpt
  ON lpt.product_id = mp.product_id
 AND lpt.currency_code = mp.currency_code;
