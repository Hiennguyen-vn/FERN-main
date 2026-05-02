SELECT
    toHour(sale_at) AS hour_of_day,
    count() AS txn_count,
    sum(line_total) AS revenue
FROM fern.fact_sale
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
  AND sale_status != 'CANCELLED'
GROUP BY hour_of_day
ORDER BY hour_of_day ASC
LIMIT 24
