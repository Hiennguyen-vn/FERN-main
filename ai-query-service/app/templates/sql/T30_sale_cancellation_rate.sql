SELECT
    business_date,
    sum(cancelled_txn_count) AS cancelled_count,
    sum(txn_count + cancelled_txn_count) AS total_count,
    sum(cancelled_txn_count) / nullIf(sum(txn_count + cancelled_txn_count), 0) AS cancellation_rate
FROM analytics.ai_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY business_date
ORDER BY business_date DESC
LIMIT 1000
