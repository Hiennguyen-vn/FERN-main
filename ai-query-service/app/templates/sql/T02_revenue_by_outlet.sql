SELECT
    outlet_id,
    any(outlet_name) AS outlet_name,
    sum(net_revenue) AS net_revenue,
    sum(txn_count)   AS txn_count
FROM analytics.ai_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY outlet_id
ORDER BY net_revenue DESC
LIMIT 1000
