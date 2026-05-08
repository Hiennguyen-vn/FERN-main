SELECT
    business_date,
    sum(line_total - discount_amount) / nullIf(countDistinct(sale_id), 0) AS avg_basket_size,
    countDistinct(sale_id) AS txn_count
FROM fern.fact_sale
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
  AND sale_status != 'CANCELLED'
GROUP BY business_date
ORDER BY business_date DESC
LIMIT 1000
