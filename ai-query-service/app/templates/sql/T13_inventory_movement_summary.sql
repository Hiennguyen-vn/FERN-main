SELECT
    outlet_id,
    txn_type,
    count() AS txn_count,
    sum(qty_change) AS qty_total
FROM cdc.inventory_transaction
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY outlet_id, txn_type
ORDER BY outlet_id, txn_type
LIMIT 1000
