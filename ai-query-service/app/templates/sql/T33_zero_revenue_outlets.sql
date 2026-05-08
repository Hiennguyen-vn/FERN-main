SELECT
    o.outlet_id,
    o.code AS outlet_code,
    o.name AS outlet_name,
    o.status AS outlet_status,
    coalesce(r.net_revenue, 0) AS net_revenue,
    coalesce(r.txn_count, 0) AS txn_count,
    r.first_business_date,
    r.last_business_date,
    '{{ from_date }}' AS requested_from_date,
    '{{ to_date }}' AS requested_to_date
FROM (
    SELECT
        id AS outlet_id,
        code,
        name,
        status
    FROM cdc.outlet FINAL
    WHERE coalesce(__deleted, 'false') = 'false'
) AS o
LEFT JOIN (
    SELECT
        outlet_id,
        sum(net_revenue) AS net_revenue,
        sum(txn_count) AS txn_count,
        min(business_date) AS first_business_date,
        max(business_date) AS last_business_date
    FROM analytics.ai_sales_daily
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
      AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
    GROUP BY outlet_id
) AS r ON r.outlet_id = o.outlet_id
WHERE o.outlet_id IN ({{ outlet_ids | join(',') }})
  AND coalesce(r.net_revenue, 0) <= 0
ORDER BY o.name
LIMIT 1000
