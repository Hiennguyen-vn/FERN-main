SELECT
    outlet_id,
    any(outlet_name) AS outlet_name,
    movement_type,
    sumIf(qty_change, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_qty_change,
    countDistinctIf(business_date, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_days,
    avgIf(qty_change, business_date < toDate('{{ from_date }}')) AS baseline_daily_avg,
    stddevSampIf(qty_change, business_date < toDate('{{ from_date }}')) AS baseline_daily_stddev,
    countIf(business_date < toDate('{{ from_date }}')) AS baseline_days,
    if(current_days = 0, 0, current_qty_change / current_days) AS current_daily_avg,
    if(baseline_daily_stddev = 0, 0, (current_daily_avg - baseline_daily_avg) / baseline_daily_stddev) AS z_score,
    current_daily_avg - baseline_daily_avg AS daily_delta,
    abs(daily_delta) AS impact_abs
FROM analytics.ai_inventory_movement_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN toDate('{{ from_date }}') - 28 AND toDate('{{ to_date }}')
GROUP BY outlet_id, movement_type
HAVING baseline_days >= 14 AND abs(z_score) >= 2
ORDER BY abs(z_score) DESC, impact_abs DESC
LIMIT {{ limit | default(20) }}
