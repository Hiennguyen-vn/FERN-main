SELECT
    s.outlet_id,
    o.name AS outlet_name,
    sum(s.net_revenue) AS net_revenue,
    sum(s.txn_count)   AS txn_count
FROM analytics.fct_sales_daily s
LEFT JOIN (SELECT id, name FROM cdc.outlet FINAL) o ON s.outlet_id = o.id
WHERE s.outlet_id IN ({{ outlet_ids | join(',') }})
  AND s.business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY s.outlet_id, o.name
ORDER BY net_revenue DESC
LIMIT 1000
