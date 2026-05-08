-- Giờ cao điểm: gộp theo giờ tạo đơn (sale header). Dùng cdc.sale_record thay vì fact_sale
-- để vẫn có kết quả khi CDC chỉ sink header đơn mà chưa có dòng sale_item trong fact_sale.
SELECT
    toHour(sr.created_at) AS hour_of_day,
    count()              AS txn_count,
    sum(sr.total_amount) AS revenue
FROM cdc.sale_record AS sr FINAL
WHERE sr.outlet_id IN ({{ outlet_ids | join(',') }})
  AND sr.business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
  AND coalesce(sr.__deleted, 'false') = 'false'
  AND lower(sr.status) NOT IN ('cancelled', 'voided', 'open')
GROUP BY hour_of_day
ORDER BY hour_of_day ASC
LIMIT 24
