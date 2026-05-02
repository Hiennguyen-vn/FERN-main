SELECT
    business_date,
    sum(gross_revenue)  AS gross_revenue,
    sum(net_revenue)    AS net_revenue,
    sum(txn_count)      AS txn_count,
    sum(total_discount) AS total_discount
FROM analytics.fct_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY business_date
ORDER BY business_date DESC
LIMIT 1000
