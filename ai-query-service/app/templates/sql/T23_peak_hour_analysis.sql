SELECT
    toHour(fs.sale_created_at) AS hour_of_day,
    count()                    AS txn_count,
    sum(fs.line_total)         AS revenue
FROM cdc.fact_sale AS fs FINAL
INNER JOIN (
    SELECT id
    FROM cdc.sale_record FINAL
    WHERE status NOT IN ('cancelled', 'voided', 'open')
      AND outlet_id IN ({{ outlet_ids | join(',') }})
) sr ON fs.sale_id = sr.id
WHERE fs.outlet_id IN ({{ outlet_ids | join(',') }})
  AND fs.business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY hour_of_day
ORDER BY hour_of_day ASC
LIMIT 24
