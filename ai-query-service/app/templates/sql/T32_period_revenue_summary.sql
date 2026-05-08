SELECT
    sum(gross_revenue) AS gross_revenue,
    sum(net_revenue) AS net_revenue,
    sum(txn_count) AS txn_count,
    sum(total_discount) AS total_discount,
    min(business_date) AS first_business_date,
    max(business_date) AS last_business_date,
    countDistinct(business_date) AS business_days,
    countDistinct(outlet_id) AS outlet_count
FROM analytics.ai_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
LIMIT 1000
