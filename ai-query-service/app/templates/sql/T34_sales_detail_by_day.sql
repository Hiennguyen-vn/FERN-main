SELECT
    sr.id AS sale_id,
    sr.business_date,
    sr.created_at AS sale_created_at,
    sr.outlet_id,
    o.code AS outlet_code,
    o.name AS outlet_name,
    sr.status AS sale_status,
    sr.payment_status,
    sr.subtotal AS sale_subtotal,
    sr.discount AS sale_discount,
    sr.tax_amount AS sale_tax_amount,
    sr.total_amount AS sale_total_amount,
    fs.product_id,
    p.code AS product_code,
    coalesce(p.name, fs.variant_name, toString(fs.product_id)) AS product_name,
    fs.variant_id,
    fs.variant_name,
    fs.qty,
    fs.unit_price,
    fs.discount_amount AS line_discount_amount,
    fs.tax_amount AS line_tax_amount,
    fs.line_total
FROM (
    SELECT
        id,
        business_date,
        created_at,
        outlet_id,
        status,
        payment_status,
        subtotal,
        discount,
        tax_amount,
        total_amount
    FROM cdc.sale_record FINAL
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
      AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
      AND coalesce(__deleted, 'false') = 'false'
) AS sr
LEFT JOIN (
    SELECT
        sale_id,
        outlet_id,
        business_date,
        product_id,
        variant_id,
        variant_name,
        qty,
        unit_price,
        discount_amount,
        tax_amount,
        line_total
    FROM cdc.fact_sale FINAL
    WHERE outlet_id IN ({{ outlet_ids | join(',') }})
      AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
      AND coalesce(__deleted, 'false') = 'false'
) AS fs
    ON fs.sale_id = sr.id
   AND fs.outlet_id = sr.outlet_id
LEFT JOIN (
    SELECT
        id,
        code,
        name
    FROM cdc.outlet FINAL
    WHERE coalesce(__deleted, 'false') = 'false'
) AS o
    ON o.id = sr.outlet_id
LEFT JOIN (
    SELECT
        id,
        code,
        name
    FROM cdc.product FINAL
    WHERE coalesce(__deleted, 'false') = 'false'
) AS p
    ON p.id = fs.product_id
WHERE sr.outlet_id IN ({{ outlet_ids | join(',') }})
ORDER BY sr.business_date DESC, sr.created_at DESC, sr.id, fs.product_id
LIMIT 1000
