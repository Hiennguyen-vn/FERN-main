SELECT
    toMonday(toDate(business_date)) AS week_start,
    sum(gross_revenue)  AS gross_revenue,
    sum(net_revenue)    AS net_revenue,
    sum(txn_count)      AS txn_count
FROM analytics.ai_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY week_start
ORDER BY week_start ASC
LIMIT 1000
