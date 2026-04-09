EXPLAIN (ANALYZE, BUFFERS)
SELECT gr.id AS goods_receipt_id,
       po.outlet_id,
       gr.business_date,
       gr.currency_code,
       gr.total_price
FROM core.goods_receipt gr
JOIN core.purchase_order po ON po.id = gr.po_id
WHERE gr.id = 8000;
