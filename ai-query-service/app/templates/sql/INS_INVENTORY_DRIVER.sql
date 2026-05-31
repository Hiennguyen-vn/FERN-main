SELECT
    outlet_id,
    any(outlet_name) AS outlet_name,
    movement_type,
    sumIf(qty_change, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_qty_change,
    sumIf(
        qty_change,
        business_date BETWEEN
            toDate('{{ from_date }}') - (dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1))
            AND toDate('{{ from_date }}') - 1
    ) AS baseline_qty_change,
    current_qty_change - baseline_qty_change AS delta_qty_change,
    if(baseline_qty_change = 0, 0, delta_qty_change / abs(baseline_qty_change)) AS delta_pct,
    abs(delta_qty_change) AS impact_abs
FROM analytics.ai_inventory_movement_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN
      toDate('{{ from_date }}') - (dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1))
      AND toDate('{{ to_date }}')
GROUP BY outlet_id, movement_type
HAVING current_qty_change != 0 OR baseline_qty_change != 0
ORDER BY impact_abs DESC
LIMIT {{ limit | default(20) }}
