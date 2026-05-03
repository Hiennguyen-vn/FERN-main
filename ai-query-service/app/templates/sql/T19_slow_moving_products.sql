SELECT
    product_id,
    min(product_name) AS product_name,
    sum(qty)     AS total_qty,
    sum(revenue) AS revenue
FROM analytics.fct_sales_by_product
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY product_id
ORDER BY total_qty ASC
LIMIT 50
