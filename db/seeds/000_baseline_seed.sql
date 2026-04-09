BEGIN;

/* =========================================================
   000_baseline_seed.sql
   Minimal shared reference data for local operation.
   Intentionally excludes regions, outlets, users, and any
   sample operational records.
   ========================================================= */

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', 'EUR', 2),
  ('VND', 'Vietnamese Dong', 'VND', 0)
ON CONFLICT (code) DO NOTHING;

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

COMMIT;
