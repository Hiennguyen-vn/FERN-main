SELECT
    business_date,
    sum(net_revenue) / nullIf(sum(txn_count), 0) AS avg_basket_size,
    sum(txn_count) AS txn_count
FROM analytics.fct_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY business_date
ORDER BY business_date DESC
LIMIT 1000
