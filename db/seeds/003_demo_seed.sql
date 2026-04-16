BEGIN;

/* =========================================================
   003_demo_seed.sql
   Multi-outlet demonstration scenario.
   Assumes 001_reference_seed.sql and 002_sample_operational_seed.sql
   have already been applied.
   ========================================================= */

/* ---------------------------------------------------------
   Second outlet in HCM region
   --------------------------------------------------------- */

INSERT INTO core.outlet (
  id, region_id, code, name, status,
  address, phone, email, opened_at
)
VALUES (
  2002, 1001, 'VN-HCM-002', 'Saigon District 7 Outlet', 'active',
  'District 7, Ho Chi Minh City', '+84-28-0000-0002', 'hcm002@example.com',
  DATE '2024-06-01'
)
ON CONFLICT (id) DO NOTHING;

/* ---------------------------------------------------------
   Additional users
   --------------------------------------------------------- */

INSERT INTO core.app_user (
  id, username, password_hash, full_name, employee_code, status
)
VALUES
  (3003, 'manager.hcm2', 'replace-with-real-password-hash', 'HCM2 Manager', 'VN-HCM-MANAGER-0002', 'active'),
  (3004, 'cashier.hcm2', 'replace-with-real-password-hash', 'HCM2 Cashier', 'VN-HCM-CASHIER-0002', 'active')
ON CONFLICT (id) DO NOTHING;

/* Cross-outlet role assignments */
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (3003, 'outlet_manager', 2002),
  (3004, 'cashier', 2002),
  (3000, 'admin', 2002)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

/* ---------------------------------------------------------
   Second product (Espresso)
   --------------------------------------------------------- */

INSERT INTO core.product (
  id, code, name, category_code, status,
  created_by_user_id, updated_by_user_id
)
VALUES (5001, 'ESPRESSO', 'Espresso', 'beverage', 'active', 3000, 3000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.recipe (
  product_id, version, yield_qty, yield_uom_code,
  status, created_by_user_id
)
VALUES (5001, 'v1', 1.0000, 'cup', 'active', 3000)
ON CONFLICT (product_id, version) DO NOTHING;

INSERT INTO core.recipe_item (
  product_id, version, item_id, uom_code, qty
)
VALUES (5001, 'v1', 4000, 'g', 20.0000)
ON CONFLICT (product_id, version, item_id) DO NOTHING;

/* Availability and pricing at both outlets */
INSERT INTO core.product_outlet_availability (product_id, outlet_id, is_available)
VALUES
  (5000, 2002, TRUE),
  (5001, 2000, TRUE),
  (5001, 2002, TRUE)
ON CONFLICT (product_id, outlet_id) DO NOTHING;

INSERT INTO core.product_price (
  product_id, outlet_id, currency_code, price_value,
  effective_from, created_by_user_id, updated_by_user_id
)
VALUES
  (5000, 2002, 'VND', 60000.00, DATE '2024-06-01', 3000, 3000),
  (5001, 2000, 'VND', 55000.00, DATE '2024-01-01', 3000, 3000),
  (5001, 2002, 'VND', 50000.00, DATE '2024-06-01', 3000, 3000)
ON CONFLICT (product_id, outlet_id, effective_from) DO NOTHING;

/* ---------------------------------------------------------
   Shifts and work schedules at outlet 2
   --------------------------------------------------------- */

INSERT INTO core.shift (
  id, outlet_id, code, name,
  start_time, end_time, break_minutes,
  daypart, headcount_required
)
VALUES
  (9000, 2002, 'OPEN',  'Opening / Prep',    TIME '06:00', TIME '09:00', 0,  'opening',    2),
  (9001, 2002, 'LUNCH', 'Lunch Peak',        TIME '11:00', TIME '15:00', 30, 'lunch_peak', 5),
  (9002, 2002, 'AFT',   'Afternoon',         TIME '15:00', TIME '20:00', 30, 'afternoon',  3),
  (9003, 2002, 'CLOSE', 'Closing',           TIME '20:00', TIME '23:00', 0,  'closing',    1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.shift_role_requirement (id, shift_id, work_role, required_count, is_optional)
VALUES
  (9500, 9000, 'cashier',       1, false),
  (9501, 9000, 'prep',          1, false),
  (9502, 9001, 'cashier',       2, false),
  (9503, 9001, 'kitchen_staff', 2, false),
  (9504, 9001, 'support',       1, false),
  (9505, 9002, 'cashier',       1, false),
  (9506, 9002, 'kitchen_staff', 1, false),
  (9507, 9002, 'support',       1, true),
  (9508, 9003, 'closing_support', 1, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.work_shift (
  id, shift_id, user_id, work_date, work_role,
  schedule_status, attendance_status, approval_status,
  assigned_by_user_id
)
VALUES
  -- Historical (2024-07-01) demo data
  (9100, 9000, 3003, DATE '2024-07-01', 'cashier',       'scheduled', 'present',  'approved', 3003),
  (9101, 9000, 3002, DATE '2024-07-01', 'prep',          'scheduled', 'present',  'approved', 3003),
  (9102, 9001, 3003, DATE '2024-07-01', 'cashier',       'scheduled', 'present',  'approved', 3003),
  (9103, 9001, 3002, DATE '2024-07-01', 'kitchen_staff', 'scheduled', 'late',     'approved', 3003),
  -- Current-week demo data (week of 2026-04-14)
  (9110, 9000, 3003, DATE '2026-04-14', 'cashier',        'scheduled', 'present', 'approved', 3003),
  (9111, 9000, 3002, DATE '2026-04-14', 'kitchen_staff',  'scheduled', 'present', 'pending',  3003),
  (9112, 9001, 3003, DATE '2026-04-15', 'cashier',        'scheduled', 'pending', 'pending',  3003),
  (9113, 9002, 3002, DATE '2026-04-15', 'cashier',        'scheduled', 'pending', 'pending',  3003),
  (9114, 9000, 3003, DATE '2026-04-16', 'cashier',        'scheduled', 'pending', 'pending',  3003),
  (9115, 9001, 3002, DATE '2026-04-16', 'kitchen_staff',  'scheduled', 'pending', 'pending',  3003),
  (9116, 9002, 3003, DATE '2026-04-17', 'cashier',        'scheduled', 'pending', 'pending',  3003),
  (9117, 9003, 3002, DATE '2026-04-17', 'closing_support','scheduled', 'pending', 'pending',  3003)
ON CONFLICT (id) DO NOTHING;

/* ---------------------------------------------------------
   POS sessions and sales at both outlets
   --------------------------------------------------------- */

INSERT INTO core.pos_session (
  id, session_code, outlet_id, currency_code,
  manager_id, opened_at, business_date, status
)
VALUES
  (9200, 'POS-HCM1-20240701', 2000, 'VND', 3001,
   TIMESTAMPTZ '2024-07-01 08:00:00+07', DATE '2024-07-01', 'closed'),
  (9201, 'POS-HCM2-20240701', 2002, 'VND', 3003,
   TIMESTAMPTZ '2024-07-01 08:00:00+07', DATE '2024-07-01', 'closed')
ON CONFLICT (id) DO NOTHING;

/* Sale at outlet 1 */
INSERT INTO core.sale_record (
  id, outlet_id, pos_session_id, currency_code,
  order_type, status, payment_status,
  subtotal, discount, tax_amount, total_amount
)
VALUES (
  9300, 2000, 9200, 'VND',
  'dine_in', 'completed', 'paid',
  65000.00, 0.00, 6500.00, 71500.00
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.sale_item (
  sale_id, product_id, unit_price, qty,
  discount_amount, tax_amount, line_total
)
VALUES (9300, 5000, 65000.00, 1.0000, 0.00, 6500.00, 71500.00)
ON CONFLICT (sale_id, product_id) DO NOTHING;

INSERT INTO core.payment (
  sale_id, pos_session_id, payment_method, amount,
  status, payment_time
)
VALUES (
  9300, 9200, 'cash', 71500.00, 'success',
  TIMESTAMPTZ '2024-07-01 09:30:00+07'
)
ON CONFLICT (sale_id) DO NOTHING;

/* Sale at outlet 2 */
INSERT INTO core.sale_record (
  id, outlet_id, pos_session_id, currency_code,
  order_type, status, payment_status,
  subtotal, discount, tax_amount, total_amount
)
VALUES (
  9301, 2002, 9201, 'VND',
  'takeaway', 'completed', 'paid',
  50000.00, 5000.00, 4500.00, 49500.00
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.sale_item (
  sale_id, product_id, unit_price, qty,
  discount_amount, tax_amount, line_total
)
VALUES (9301, 5001, 50000.00, 1.0000, 5000.00, 4500.00, 49500.00)
ON CONFLICT (sale_id, product_id) DO NOTHING;

INSERT INTO core.payment (
  sale_id, pos_session_id, payment_method, amount,
  status, payment_time
)
VALUES (
  9301, 9201, 'card', 49500.00, 'success',
  TIMESTAMPTZ '2024-07-01 10:15:00+07'
)
ON CONFLICT (sale_id) DO NOTHING;

/* ---------------------------------------------------------
   Inventory transactions at both outlets
   --------------------------------------------------------- */

INSERT INTO core.inventory_transaction (
  id, outlet_id, item_id, qty_change,
  business_date, txn_time, txn_type,
  unit_cost, created_by_user_id
)
VALUES
  (9400, 2000, 4000, 2000.0000, DATE '2024-07-01',
   TIMESTAMPTZ '2024-07-01 07:00:00+07', 'purchase_in', 250.0000, 3001),
  (9401, 2002, 4000, 1500.0000, DATE '2024-07-01',
   TIMESTAMPTZ '2024-07-01 07:00:00+07', 'purchase_in', 250.0000, 3003),
  (9402, 2000, 4000, -18.0000, DATE '2024-07-01',
   TIMESTAMPTZ '2024-07-01 09:30:00+07', 'sale_usage', NULL, 3002),
  (9403, 2002, 4000, -20.0000, DATE '2024-07-01',
   TIMESTAMPTZ '2024-07-01 10:15:00+07', 'sale_usage', NULL, 3004)
ON CONFLICT (id) DO NOTHING;

COMMIT;
