SELECT
    outlet_id,
    item_id,
    sum(qty_change) / dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1) AS daily_avg_change
FROM fern.fact_inventory_movement
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
  AND txn_type = 'CONSUMPTION'
GROUP BY outlet_id, item_id
ORDER BY daily_avg_change ASC
LIMIT 1000
