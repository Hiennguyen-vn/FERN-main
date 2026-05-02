SELECT
    businessDate AS receipt_date,
    outletId AS outlet_id,
    sum(totalPrice) AS total_cost,
    count() AS receipt_count
FROM fern.events_goods_receipt_posted
WHERE outletId IN ({{ outlet_ids | join(',') }})
  AND businessDate BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY receipt_date, outletId
ORDER BY receipt_date DESC, outletId
LIMIT 1000
