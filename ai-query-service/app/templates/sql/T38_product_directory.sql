SELECT
    product_id,
    any(product_name) AS product_name,
    any(category_code) AS category_code,
    countDistinct(outlet_id) AS outlet_count,
    sum(qty) AS total_qty,
    count() OVER () AS total_products
FROM analytics.ai_product_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
GROUP BY product_id
ORDER BY category_code ASC, product_name ASC
LIMIT {{ limit | default(50, true) }}
