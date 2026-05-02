SELECT
    outletId AS outlet_id,
    itemId AS item_id,
    qtyOnHand AS qty_on_hand,
    reorderThreshold AS threshold,
    detectedAt AS detected_at
FROM fern.events_stock_low
WHERE outletId IN ({{ outlet_ids | join(',') }})
  AND toDate(detectedAt) BETWEEN '{{ from_date }}' AND '{{ to_date }}'
ORDER BY detectedAt DESC
LIMIT 1000
