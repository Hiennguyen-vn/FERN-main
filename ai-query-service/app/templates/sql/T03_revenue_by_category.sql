SELECT
    category_id,
    any(category_name) AS category_name,
    sum(revenue) AS revenue,
    sum(qty)     AS qty
FROM analytics.fct_sales_by_category
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY category_id
ORDER BY revenue DESC
LIMIT 1000
