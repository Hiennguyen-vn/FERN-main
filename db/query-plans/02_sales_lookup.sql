EXPLAIN (ANALYZE, BUFFERS)
SELECT sr.id,
       sr.outlet_id,
       sr.pos_session_id,
       sr.currency_code,
       sr.order_type,
       sr.status,
       sr.payment_status,
       sr.total_amount,
       p.payment_method,
       p.status AS payment_status_detail
FROM core.sale_record sr
LEFT JOIN core.payment p ON p.sale_id = sr.id
WHERE sr.id = 9300;
