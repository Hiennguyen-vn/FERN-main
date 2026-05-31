SELECT
    outlet_id,
    item_id,
    sum(qty_change) / dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1) AS daily_avg_change
FROM analytics.ai_inventory_movement_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
  AND lower(movement_type) IN ('consumption', 'sale_usage', 'manufacture_out')
GROUP BY outlet_id, item_id
ORDER BY daily_avg_change ASC
LIMIT 1000
