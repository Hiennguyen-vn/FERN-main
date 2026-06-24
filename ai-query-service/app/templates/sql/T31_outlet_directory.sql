SELECT
    o.outlet_id,
    o.code AS outlet_code,
    o.name AS outlet_name,
    o.status AS outlet_status,
    o.region_id,
    o.created_at,
    o.updated_at
FROM (
    SELECT
        id AS outlet_id,
        code,
        name,
        status,
        region_id,
        created_at,
        updated_at
    FROM cdc.outlet FINAL
    WHERE coalesce(__deleted, 'false') = 'false'
) AS o
WHERE o.outlet_id IN ({{ outlet_ids | join(',') }})
ORDER BY o.name
LIMIT 1000
