SELECT
    toHour(sr.created_at) AS hour_of_day,
    count()              AS txn_count,
    sum(sr.total_amount) AS revenue
FROM cdc.sale_record AS sr FINAL
WHERE sr.outlet_id IN ({{ outlet_ids | join(',') }})
  AND sr.business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
  AND coalesce(sr.__deleted, 'false') = 'false'
  AND lower(sr.status) NOT IN ('cancelled', 'voided', 'open')
GROUP BY hour_of_day
ORDER BY hour_of_day ASC
LIMIT 24
