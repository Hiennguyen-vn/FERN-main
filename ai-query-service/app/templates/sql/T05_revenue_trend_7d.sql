SELECT
    business_date,
    sum(net_revenue) AS net_revenue,
    sum(txn_count)   AS txn_count
FROM analytics.fct_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date >= today() - 7
GROUP BY business_date
ORDER BY business_date ASC
LIMIT 1000
