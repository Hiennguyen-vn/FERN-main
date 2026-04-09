EXPLAIN (ANALYZE, BUFFERS)
SELECT outlet_id,
       business_date,
       source_type,
       COUNT(*) AS expense_count,
       COALESCE(SUM(amount), 0) AS total_amount
FROM core.expense_record
WHERE outlet_id = 2000
  AND business_date BETWEEN DATE '2024-03-01' AND DATE '2026-12-31'
GROUP BY outlet_id, business_date, source_type
ORDER BY business_date DESC, source_type;
