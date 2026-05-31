WITH toDate('{{ to_date }}') AS as_of_date
SELECT
    h.outlet_id,
    h.item_id,
    h.snapshot_date,
    h.qty_on_hand,
    coalesce(m.avg_daily_consumption, 0) AS avg_daily_consumption,
    if(avg_daily_consumption = 0, NULL, h.qty_on_hand / avg_daily_consumption) AS days_of_cover
FROM (
    SELECT
        outlet_id,
        item_id,
        as_of_date AS snapshot_date,
        sum(qty_change) AS qty_on_hand
    FROM cdc.inventory_transaction
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
      AND coalesce(__deleted, 'false') = 'false'
      AND business_date <= as_of_date
    GROUP BY outlet_id, item_id
) AS h
LEFT JOIN (
    SELECT
        outlet_id,
        item_id,
        abs(sum(qty_change)) / 28 AS avg_daily_consumption
    FROM cdc.inventory_transaction
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
      AND coalesce(__deleted, 'false') = 'false'
      AND business_date BETWEEN as_of_date - 27 AND as_of_date
      AND lower(txn_type) IN ('consumption', 'sale_usage', 'manufacture_out')
    GROUP BY outlet_id, item_id
) AS m ON h.outlet_id = m.outlet_id AND h.item_id = m.item_id
WHERE h.outlet_id IN ({{ outlet_ids | join(',') }})
ORDER BY days_of_cover ASC NULLS LAST, h.qty_on_hand ASC
LIMIT {{ limit | default(100) }}
