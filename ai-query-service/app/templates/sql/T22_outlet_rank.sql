SELECT
    s.outlet_id,
    o.name AS outlet_name,
    sum(s.net_revenue) AS net_revenue,
    rank() OVER (ORDER BY sum(s.net_revenue) DESC) AS rank
FROM analytics.fct_sales_daily s
LEFT JOIN fern.dim_outlet o ON s.outlet_id = o.outlet_id
WHERE s.outlet_id IN ({{ outlet_ids | join(',') }})
  AND s.business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY s.outlet_id, o.name
ORDER BY rank ASC
LIMIT 1000
