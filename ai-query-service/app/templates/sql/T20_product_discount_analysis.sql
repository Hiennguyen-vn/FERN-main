SELECT
    fs.product_id,
    any(p.name)                                                           AS product_name,
    sum(fs.line_total)                                                    AS gross,
    sum(fs.discount_amount)                                               AS discount,
    sum(fs.discount_amount) / nullIf(sum(fs.line_total), 0)              AS discount_rate
FROM cdc.fact_sale AS fs FINAL
INNER JOIN (
    SELECT id
    FROM cdc.sale_record FINAL
    WHERE status NOT IN ('cancelled', 'voided', 'open')
      AND outlet_id IN ({{ outlet_ids | join(',') }})
) sr ON fs.sale_id = sr.id
LEFT JOIN (SELECT id, name FROM cdc.product FINAL) p ON fs.product_id = p.id
WHERE fs.outlet_id IN ({{ outlet_ids | join(',') }})
  AND fs.business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY fs.product_id
ORDER BY discount_rate DESC
LIMIT 100
