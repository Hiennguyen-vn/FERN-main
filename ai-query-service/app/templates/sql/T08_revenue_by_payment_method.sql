SELECT
    payment_method,
    sum(revenue)   AS revenue,
    sum(txn_count) AS txn_count
FROM analytics.fct_payment_split
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY payment_method
ORDER BY revenue DESC
LIMIT 100
