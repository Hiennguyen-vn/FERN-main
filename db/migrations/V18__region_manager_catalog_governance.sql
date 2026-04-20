-- Consolidate catalog governance under region_manager and retire product_manager
-- as a standalone system role.

INSERT INTO core.permission (code, name, description)
VALUES (
  'product.catalog.write',
  'Product Catalog Write',
  'Allows product, recipe, and pricing changes'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  deleted_at = NULL,
  updated_at = NOW();

INSERT INTO core.role (code, name, description, status)
VALUES (
  'region_manager',
  'Region Manager',
  'Operational oversight and catalog management across a region',
  'active'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = 'active',
  deleted_at = NULL,
  updated_at = NOW();

INSERT INTO core.role_permission (role_code, permission_code)
VALUES ('region_manager', 'product.catalog.write')
ON CONFLICT (role_code, permission_code) DO NOTHING;

INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT ur.user_id, 'region_manager', ur.outlet_id
FROM core.user_role ur
WHERE ur.role_code = 'product_manager'
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

DELETE FROM core.user_role
WHERE role_code = 'product_manager';

DELETE FROM core.role_permission
WHERE role_code = 'product_manager';

UPDATE core.role
SET status = 'inactive',
    deleted_at = COALESCE(deleted_at, NOW()),
    updated_at = NOW()
WHERE code = 'product_manager';
