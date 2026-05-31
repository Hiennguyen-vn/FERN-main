SELECT
    outlet_id,
    movement_type AS txn_type,
    sum(movement_count) AS txn_count,
    sum(qty_change) AS qty_total
FROM analytics.ai_inventory_movement_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY outlet_id, movement_type
ORDER BY outlet_id, movement_type
LIMIT 1000
