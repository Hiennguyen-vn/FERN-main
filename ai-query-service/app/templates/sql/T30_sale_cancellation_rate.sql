SELECT
    business_date,
    countIf(status = 'cancelled')                                                AS cancelled_count,
    countIf(status NOT IN ('open'))                                              AS total_count,
    countIf(status = 'cancelled') / nullIf(countIf(status NOT IN ('open')), 0)  AS cancellation_rate
FROM cdc.sale_record FINAL
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY business_date
ORDER BY business_date DESC
LIMIT 1000
