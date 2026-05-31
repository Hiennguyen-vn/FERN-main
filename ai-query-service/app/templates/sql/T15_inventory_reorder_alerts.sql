WITH (
    SELECT max(business_date)
    FROM cdc.inventory_transaction
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
      AND coalesce(__deleted, 'false') = 'false'
) AS snapshot_date
SELECT
    outlet_id,
    item_id,
    snapshot_date,
    sum(qty_change) AS qty_on_hand
FROM cdc.inventory_transaction
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND coalesce(__deleted, 'false') = 'false'
  AND business_date <= snapshot_date
GROUP BY outlet_id, item_id
HAVING qty_on_hand <= 0
ORDER BY qty_on_hand ASC
LIMIT 1000
