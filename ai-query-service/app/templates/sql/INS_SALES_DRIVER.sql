SELECT
    outlet_id,
    any(outlet_name) AS outlet_name,
    sumIf(net_revenue, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_revenue,
    sumIf(
        net_revenue,
        business_date BETWEEN
            toDate('{{ from_date }}') - (dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1))
            AND toDate('{{ from_date }}') - 1
    ) AS baseline_revenue,
    sumIf(txn_count, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_txn_count,
    sumIf(
        txn_count,
        business_date BETWEEN
            toDate('{{ from_date }}') - (dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1))
            AND toDate('{{ from_date }}') - 1
    ) AS baseline_txn_count,
    current_revenue - baseline_revenue AS delta_revenue,
    if(baseline_revenue = 0, 0, delta_revenue / baseline_revenue) AS delta_pct,
    abs(delta_revenue) AS impact_abs
FROM analytics.ai_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN
      toDate('{{ from_date }}') - (dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1))
      AND toDate('{{ to_date }}')
GROUP BY outlet_id
HAVING current_revenue != 0 OR baseline_revenue != 0
ORDER BY impact_abs DESC
LIMIT {{ limit | default(20) }}
