SELECT
    product_id,
    product_name,
    revenue,
    qty,
    revenue / nullIf(sum(revenue) OVER (), 0) AS revenue_share
FROM (
    SELECT
        {{ outlet_ids[0] }} AS outlet_id,
        product_id,
        min(product_name) AS product_name,
        sum(revenue) AS revenue,
        sum(qty)     AS qty
    FROM analytics.ai_product_daily
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
      AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
    GROUP BY product_id
)
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
ORDER BY revenue DESC
LIMIT 1000
