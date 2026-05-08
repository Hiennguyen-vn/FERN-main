SELECT
    outlet_id,
    outlet_name,
    net_revenue,
    rank() OVER (ORDER BY net_revenue DESC) AS rank
FROM (
    SELECT
        outlet_id,
        any(outlet_name) AS outlet_name,
        sum(net_revenue) AS net_revenue
    FROM analytics.ai_sales_daily
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
      AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
    GROUP BY outlet_id
)
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
ORDER BY rank ASC
LIMIT 1000
