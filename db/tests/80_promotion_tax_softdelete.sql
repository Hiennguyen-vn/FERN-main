BEGIN;

/* =========================================================
   Setup: currency, region, outlet, user, items, products
   ========================================================= */

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES ('PT0', 'Promo Tax Currency', 'P', 2);

INSERT INTO core.region (
  id, code, currency_code, name, timezone_name
)
VALUES (980000, 'PT-ROOT', 'PT0', 'Promo Tax Region', 'Asia/Ho_Chi_Minh');

INSERT INTO core.outlet (
  id, region_id, code, name, status, opened_at
)
VALUES (980001, 980000, 'PT-ROOT-001', 'Promo Tax Outlet', 'active', DATE '2025-01-01');

INSERT INTO core.app_user (
  id, username, password_hash, full_name, employee_code
)
VALUES (980100, 'promo.user', 'hash', 'Promo Tax User', 'PT-EMP-001');

INSERT INTO core.item_category (code, name)
VALUES ('pt-raw', 'PT Raw');

INSERT INTO core.product_category (code, name)
VALUES ('pt-product', 'PT Product');

INSERT INTO core.unit_of_measure (code, name)
VALUES ('cup', 'Cup')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.item (
  id, code, name, category_code, base_uom_code
)
VALUES (980200, 'PT-BEAN', 'PT Coffee Bean', 'pt-raw', 'cup');

INSERT INTO core.product (
  id, code, name, category_code, status,
  created_by_user_id, updated_by_user_id
)
VALUES (980201, 'PT-LATTE', 'PT Latte', 'pt-product', 'active', 980100, 980100);

/* =========================================================
   Test: promotion → scope → sale_item_promotion flow
   ========================================================= */

INSERT INTO core.promotion (
  id, name, promo_type, status,
  value_percent, min_order_amount, max_discount_amount,
  effective_from, effective_to
)
VALUES (
  980300, 'Summer 10% Off', 'percentage', 'active',
  10.0000, 50000.00, 10000.00,
  TIMESTAMPTZ '2025-06-01 00:00:00+07',
  TIMESTAMPTZ '2025-08-31 23:59:59+07'
);

INSERT INTO core.promotion_scope (promotion_id, outlet_id)
VALUES (980300, 980001);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.promotion_scope WHERE promotion_id = 980300 AND outlet_id = 980001$$,
  1,
  'promotion should be scoped to outlet'
);

INSERT INTO core.pos_session (
  id, session_code, outlet_id, currency_code,
  manager_id, opened_at, business_date, status
)
VALUES (
  980400, 'POS-PT-001', 980001, 'PT0',
  980100, TIMESTAMPTZ '2025-06-15 08:00:00+07',
  DATE '2025-06-15', 'open'
);

INSERT INTO core.sale_record (
  id, outlet_id, pos_session_id, currency_code,
  order_type, status, payment_status,
  subtotal, discount, tax_amount, total_amount
)
VALUES (
  980500, 980001, 980400, 'PT0',
  'dine_in', 'completed', 'paid',
  65000.00, 6500.00, 5850.00, 64350.00
);

INSERT INTO core.sale_item (
  sale_id, product_id, unit_price, qty,
  discount_amount, tax_amount, line_total
)
VALUES (
  980500, 980201, 65000.00, 1.0000,
  6500.00, 5850.00, 64350.00
);

INSERT INTO core.sale_item_promotion (
  sale_id, product_id, promotion_id
)
VALUES (980500, 980201, 980300);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.sale_item_promotion WHERE sale_id = 980500 AND product_id = 980201 AND promotion_id = 980300$$,
  1,
  'sale_item_promotion should link sale item to promotion'
);

/* =========================================================
   Test: tax_rate region × product × effective date
   ========================================================= */

INSERT INTO core.tax_rate (
  region_id, product_id, tax_percent,
  effective_from, effective_to
)
VALUES
  (980000, 980201, 10.00, DATE '2025-01-01', DATE '2025-06-30'),
  (980000, 980201, 8.00, DATE '2025-07-01', NULL);

SELECT test_support.assert_equals_numeric(
  (
    SELECT tax_percent FROM core.tax_rate
    WHERE region_id = 980000
      AND product_id = 980201
      AND effective_from <= DATE '2025-03-15'
      AND (effective_to IS NULL OR effective_to >= DATE '2025-03-15')
  ),
  10.00,
  'tax_rate lookup for Q1 2025 should return 10%'
);

SELECT test_support.assert_equals_numeric(
  (
    SELECT tax_percent FROM core.tax_rate
    WHERE region_id = 980000
      AND product_id = 980201
      AND effective_from <= DATE '2025-09-01'
      AND (effective_to IS NULL OR effective_to >= DATE '2025-09-01')
  ),
  8.00,
  'tax_rate lookup for Q3 2025 should return 8%'
);

/* =========================================================
   Test: soft-delete reachability
   Soft-deleted entities must still be FK-reachable
   ========================================================= */

-- Create a role, assign it, then soft-delete the role
INSERT INTO core.role (code, name)
VALUES ('pt_temp_role', 'PT Temp Role');

INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES (980100, 'pt_temp_role', 980001);

UPDATE core.role SET deleted_at = NOW() WHERE code = 'pt_temp_role';

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.user_role ur JOIN core.role r ON r.code = ur.role_code WHERE ur.user_id = 980100 AND ur.role_code = 'pt_temp_role' AND r.deleted_at IS NOT NULL$$,
  1,
  'soft-deleted role should still be joinable from user_role'
);

-- Soft-delete an item; existing inventory data should still reference it
UPDATE core.item SET deleted_at = NOW() WHERE id = 980200;

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.item WHERE id = 980200 AND deleted_at IS NOT NULL$$,
  1,
  'soft-deleted item should remain in the table with deleted_at set'
);

-- Soft-delete a user; role assignment should still reference them
UPDATE core.app_user SET deleted_at = NOW() WHERE id = 980100;

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.user_role ur JOIN core.app_user u ON u.id = ur.user_id WHERE ur.user_id = 980100 AND u.deleted_at IS NOT NULL$$,
  1,
  'soft-deleted app_user should still be joinable from user_role'
);

ROLLBACK;
