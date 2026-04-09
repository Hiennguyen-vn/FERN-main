EXPLAIN (ANALYZE, BUFFERS)
SELECT outlet_id,
       DATE(created_at) AS business_date,
       COUNT(*) AS sale_count,
       COALESCE(SUM(subtotal), 0) AS subtotal,
       COALESCE(SUM(discount), 0) AS discount,
       COALESCE(SUM(tax_amount), 0) AS tax_amount,
       COALESCE(SUM(total_amount), 0) AS total_amount
FROM core.sale_record
WHERE outlet_id = 2000
  AND created_at >= DATE '2024-07-01'
  AND created_at < (DATE '2024-07-01' + INTERVAL '1 day')
GROUP BY outlet_id, DATE(created_at)
ORDER BY business_date DESC;
