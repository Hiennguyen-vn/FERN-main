EXPLAIN (ANALYZE, BUFFERS)
SELECT outlet_id,
       item_id,
       business_date,
       txn_type,
       COALESCE(SUM(qty_change), 0) AS net_quantity_change
FROM core.inventory_transaction
WHERE outlet_id = 2000
  AND business_date BETWEEN DATE '2024-07-01' AND DATE '2024-07-31'
GROUP BY outlet_id, item_id, business_date, txn_type
ORDER BY business_date DESC, item_id, txn_type;
