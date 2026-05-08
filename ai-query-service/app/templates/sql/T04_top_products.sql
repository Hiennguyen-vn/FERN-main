SELECT
    product_id,
    any(product_name) AS product_name,
    sum(revenue) AS revenue,
    sum(qty) AS qty
FROM analytics.ai_product_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY product_id
ORDER BY qty DESC
LIMIT {{ limit | default(10) }}
