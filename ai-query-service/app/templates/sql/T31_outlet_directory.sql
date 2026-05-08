-- Master outlet list trong phạm vi RBAC (outlet_ids inject). Outer WHERE dùng outlet_id để thỏa sql_ast.
-- Địa chỉ / điện thoại từ CDC (bổ sung cho câu hỏi thông tin quản lý cửa hàng).
SELECT
    o.outlet_id,
    o.code AS outlet_code,
    o.name AS outlet_name,
    o.status AS outlet_status,
    o.region_id,
    o.address,
    o.phone,
    o.created_at,
    o.updated_at
FROM (
    SELECT
        id AS outlet_id,
        code,
        name,
        status,
        region_id,
        address,
        phone,
        created_at,
        updated_at
    FROM cdc.outlet FINAL
    WHERE coalesce(__deleted, 'false') = 'false'
) AS o
WHERE o.outlet_id IN ({{ outlet_ids | join(',') }})
ORDER BY o.name
LIMIT 1000
