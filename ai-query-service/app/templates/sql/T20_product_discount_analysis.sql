SELECT
    product_id,
    any(product_name) AS product_name,
    sum(line_total)        AS gross,
    sum(discount_amount)   AS discount,
    sum(discount_amount) / nullIf(sum(line_total), 0) AS discount_rate
FROM fern.fact_sale
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
  AND sale_status != 'CANCELLED'
GROUP BY product_id
ORDER BY discount_rate DESC
LIMIT 100
