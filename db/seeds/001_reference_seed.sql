BEGIN;

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', 'EUR', 2),
  ('VND', 'Vietnamese Dong', 'VND', 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.region (
  id,
  code,
  parent_region_id,
  currency_code,
  name,
  tax_code,
  timezone_name
)
VALUES
  (1000, 'VN', NULL, 'VND', 'Vietnam', 'VN-TAX', 'Asia/Ho_Chi_Minh'),
  (1001, 'VN-HCM', 1000, 'VND', 'Ho Chi Minh City', 'VN-HCM-TAX', 'Asia/Ho_Chi_Minh'),
  (1002, 'US', NULL, 'USD', 'United States', 'US-TAX', 'America/New_York')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.outlet (
  id,
  region_id,
  code,
  name,
  status,
  address,
  phone,
  email,
  opened_at
)
VALUES
  (2000, 1001, 'VN-HCM-001', 'Saigon Central Outlet', 'active', 'District 1, Ho Chi Minh City', '+84-28-0000-0001', 'hcm001@example.com', DATE '2024-01-01'),
  (2001, 1002, 'US-NYC-001', 'New York Flagship Outlet', 'active', 'Manhattan, New York', '+1-212-000-0001', 'nyc001@example.com', DATE '2024-02-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.role (code, name, description)
VALUES
  ('admin', 'Administrator', 'Full administrative access'),
  ('outlet_manager', 'Outlet Manager', 'Outlet-level operations management'),
  ('cashier', 'Cashier', 'Point-of-sale operator'),
  ('inventory_clerk', 'Inventory Clerk', 'Inventory stock control operations')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.permission (code, name, description)
VALUES
  ('inventory.write', 'Inventory Write', 'Allows inventory mutations such as stock counts and waste records'),
  ('inventory.adjust', 'Inventory Adjust', 'Allows manual inventory adjustments'),
  ('purchase.approve', 'Approve Purchase Order', 'Allows purchase order approval'),
  ('sale.refund', 'Refund Sale', 'Allows sale refund operations')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.role_permission (role_code, permission_code)
VALUES
  ('admin', 'inventory.write'),
  ('admin', 'inventory.adjust'),
  ('admin', 'purchase.approve'),
  ('admin', 'sale.refund'),
  ('outlet_manager', 'inventory.write'),
  ('outlet_manager', 'inventory.adjust'),
  ('outlet_manager', 'purchase.approve'),
  ('inventory_clerk', 'inventory.write')
ON CONFLICT (role_code, permission_code) DO NOTHING;

INSERT INTO core.app_user (
  id,
  username,
  password_hash,
  full_name,
  employee_code,
  status
)
VALUES
  (3000, 'admin.root', 'replace-with-real-password-hash', 'Root Admin', 'VN-HCM-ADMIN-0001', 'active'),
  (3001, 'manager.hcm', 'replace-with-real-password-hash', 'HCM Manager', 'VN-HCM-MANAGER-0001', 'active'),
  (3002, 'cashier.hcm', 'replace-with-real-password-hash', 'HCM Cashier', 'VN-HCM-CASHIER-0001', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (3000, 'admin', 2000),
  (3001, 'outlet_manager', 2000),
  (3002, 'cashier', 2000)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

INSERT INTO core.user_permission (user_id, permission_code, outlet_id)
VALUES
  (3001, 'sale.refund', 2000)
ON CONFLICT (user_id, permission_code, outlet_id) DO NOTHING;

INSERT INTO core.product_category (code, name, description)
VALUES
  ('beverage', 'Beverage', 'Finished saleable beverages')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.item_category (code, name, description)
VALUES
  ('ingredient', 'Ingredient', 'Raw ingredients and kitchen materials')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.unit_of_measure (code, name)
VALUES
  ('g', 'Gram'),
  ('kg', 'Kilogram'),
  ('ml', 'Milliliter'),
  ('cup', 'Cup')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.uom_conversion (from_uom_code, to_uom_code, conversion_factor)
VALUES
  ('g', 'kg', 0.00100000)
ON CONFLICT (from_uom_code, to_uom_code) DO NOTHING;

INSERT INTO core.item (
  id,
  code,
  name,
  category_code,
  base_uom_code,
  min_stock_level,
  max_stock_level,
  status
)
VALUES
  (4000, 'COFFEE-BEAN', 'Coffee Bean', 'ingredient', 'kg', 5.0000, 50.0000, 'active'),
  (4001, 'MILK-FRESH', 'Fresh Milk', 'ingredient', 'ml', 1000.0000, 10000.0000, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.product (
  id,
  code,
  name,
  category_code,
  status,
  created_by_user_id,
  updated_by_user_id
)
VALUES
  (5000, 'LATTE', 'Cafe Latte', 'beverage', 'active', 3000, 3000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.recipe (
  product_id,
  version,
  yield_qty,
  yield_uom_code,
  status,
  created_by_user_id
)
VALUES
  (5000, 'v1', 1.0000, 'cup', 'active', 3000)
ON CONFLICT (product_id, version) DO NOTHING;

INSERT INTO core.recipe_item (
  product_id,
  version,
  item_id,
  uom_code,
  qty
)
VALUES
  (5000, 'v1', 4000, 'g', 18.0000),
  (5000, 'v1', 4001, 'ml', 220.0000)
ON CONFLICT (product_id, version, item_id) DO NOTHING;

INSERT INTO core.product_outlet_availability (product_id, outlet_id, is_available)
VALUES
  (5000, 2000, TRUE)
ON CONFLICT (product_id, outlet_id) DO NOTHING;

INSERT INTO core.product_price (
  product_id,
  outlet_id,
  currency_code,
  price_value,
  effective_from,
  created_by_user_id,
  updated_by_user_id
)
VALUES
  (5000, 2000, 'VND', 65000.00, DATE '2024-01-01', 3000, 3000)
ON CONFLICT (product_id, outlet_id, effective_from) DO NOTHING;

COMMIT;
