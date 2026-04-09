EXPLAIN (ANALYZE, BUFFERS)
SELECT sb.location_id AS outlet_id,
       sb.item_id,
       i.code AS item_code,
       i.name AS item_name,
       sb.qty_on_hand,
       i.min_stock_level
FROM core.stock_balance sb
JOIN core.item i ON i.id = sb.item_id
WHERE sb.location_id = 2000
  AND i.min_stock_level IS NOT NULL
  AND sb.qty_on_hand <= i.min_stock_level
ORDER BY sb.qty_on_hand ASC, i.name ASC;
