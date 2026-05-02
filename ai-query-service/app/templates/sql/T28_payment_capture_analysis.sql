SELECT
    paymentMethod AS payment_method,
    toDate(capturedAt) AS capture_date,
    count() AS capture_count,
    sum(amount) AS total_amount
FROM fern.events_payment_captured
WHERE outletId IN ({{ outlet_ids | join(',') }})
  AND businessDate BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY paymentMethod, capture_date
ORDER BY capture_date DESC, total_amount DESC
LIMIT 1000
