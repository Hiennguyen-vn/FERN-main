SELECT
    outlet_id,
    item_id,
    business_date AS snapshot_date,
    qty_on_hand
FROM analytics.fct_inventory_snapshot
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date = (
    SELECT max(business_date)
    FROM analytics.fct_inventory_snapshot
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  )
  AND qty_on_hand < {{ threshold | default(10) }}
ORDER BY qty_on_hand ASC
LIMIT 1000
