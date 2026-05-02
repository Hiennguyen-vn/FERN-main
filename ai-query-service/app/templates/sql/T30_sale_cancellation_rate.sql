SELECT
    business_date,
    countIf(sale_status = 'CANCELLED') AS cancelled_count,
    count() AS total_count,
    countIf(sale_status = 'CANCELLED') / nullIf(count(), 0) AS cancellation_rate
FROM fern.fact_sale
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY business_date
ORDER BY business_date DESC
LIMIT 1000
