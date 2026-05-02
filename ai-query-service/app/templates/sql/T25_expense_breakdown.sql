SELECT
    toDate(createdAt) AS expense_date,
    outletId AS outlet_id,
    sum(amount) AS total_amount,
    count() AS expense_count
FROM fern.events_expense_created
WHERE outletId IN ({{ outlet_ids | join(',') }})
  AND toDate(createdAt) BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY expense_date, outletId
ORDER BY expense_date DESC, total_amount DESC
LIMIT 1000
