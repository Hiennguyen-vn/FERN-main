SELECT
    outlet_id,
    item_id,
    sum(qty_on_hand) AS qty_on_hand
FROM analytics.fct_inventory_snapshot
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
GROUP BY outlet_id, item_id
ORDER BY qty_on_hand ASC
LIMIT {{ limit | default(100) }}
