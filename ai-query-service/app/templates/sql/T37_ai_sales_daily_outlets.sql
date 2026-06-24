SELECT
    s.outlet_id,
    any(o.code) AS outlet_code,
    any(coalesce(o.name, s.outlet_name)) AS outlet_name,
    any(o.status) AS outlet_status,
    any(o.region_id) AS region_id,
    min(s.business_date) AS first_business_date,
    max(s.business_date) AS last_business_date,
    countDistinct(s.business_date) AS business_days,
    sum(s.net_revenue) AS net_revenue,
    sum(s.txn_count) AS txn_count
FROM analytics.ai_sales_daily AS s
LEFT JOIN (
    SELECT
        id,
        code,
        name,
        status,
        region_id
    FROM cdc.outlet FINAL
    WHERE coalesce(__deleted, 'false') = 'false'
) AS o ON o.id = s.outlet_id
WHERE s.outlet_id IN ({{ outlet_ids | join(',') }})
GROUP BY s.outlet_id
ORDER BY outlet_code, outlet_name
LIMIT 1000
