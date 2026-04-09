BEGIN;

/* =========================================================
   010_workflow_validation_seed.sql
   Deterministic seed pack for strict workflow and multi-region tests.
   Password for workflow.* users: Workflow#2026!
   ========================================================= */

INSERT INTO core.permission (code, name, description)
VALUES
  ('auth.user.write', 'Auth User Write', 'Allows user creation and outlet access changes'),
  ('auth.role.write', 'Auth Role Write', 'Allows role permission updates'),
  ('org.write', 'Organization Write', 'Allows outlet and exchange-rate administration'),
  ('product.catalog.write', 'Product Catalog Write', 'Allows product, recipe, and pricing changes'),
  ('sales.order.write', 'Sales Order Write', 'Allows sale and POS operations'),
  ('hr.write', 'HR Write', 'Allows HR schedule and contract updates'),
  ('finance.write', 'Finance Write', 'Allows finance expense entry')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.role_permission (role_code, permission_code)
VALUES
  ('admin', 'auth.user.write'),
  ('admin', 'auth.role.write'),
  ('admin', 'org.write'),
  ('admin', 'product.catalog.write'),
  ('admin', 'sales.order.write'),
  ('admin', 'hr.write'),
  ('admin', 'finance.write'),
  ('outlet_manager', 'sales.order.write'),
  ('outlet_manager', 'hr.write'),
  ('cashier', 'sales.order.write')
ON CONFLICT (role_code, permission_code) DO NOTHING;

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
  (1003, 'VN-DN', 1000, 'VND', 'Da Nang', 'VN-DN-TAX', 'Asia/Ho_Chi_Minh'),
  (1004, 'US-NYC', 1002, 'USD', 'New York City', 'US-NYC-TAX', 'America/New_York')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.exchange_rate (
  from_currency_code,
  to_currency_code,
  rate,
  effective_from,
  effective_to
)
VALUES
  ('EUR', 'USD', 1.09000000, DATE '2024-01-01', DATE '2024-12-31'),
  ('EUR', 'USD', 1.10000000, DATE '2025-01-01', NULL),
  ('USD', 'VND', 25000.00000000, DATE '2024-01-01', DATE '2024-12-31'),
  ('USD', 'VND', 25500.00000000, DATE '2025-01-01', NULL)
ON CONFLICT (from_currency_code, to_currency_code, effective_from) DO NOTHING;

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
  (2003, 1004, 'US-NYC-002', 'Brooklyn Outlet', 'active', 'Brooklyn, New York', '+1-718-000-0002', 'nyc002@example.com', DATE '2024-07-01'),
  (2004, 1003, 'VN-DN-001', 'Da Nang Riverside Outlet', 'active', 'Da Nang Riverside', '+84-236-000-0001', 'dn001@example.com', DATE '2024-05-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.ordering_table (
  id,
  outlet_id,
  table_code,
  display_name,
  public_token,
  status
)
VALUES
  (9600, 2000, 'T1', 'Table 1', 'tbl_hcm1_u7k29q', 'active'),
  (9601, 2000, 'T9', 'Table 9', 'tbl_hcm1_unavailable_9x2m', 'unavailable')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.app_user (
  id,
  username,
  password_hash,
  full_name,
  employee_code,
  email,
  status
)
VALUES
  (3010, 'workflow.admin', 'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Workflow Admin', 'GLOBAL-ADMIN-3010', 'workflow.admin@example.com', 'active'),
  (3011, 'workflow.hcm.manager', 'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Workflow HCM Manager', 'VN-HCM-MANAGER-3011', 'workflow.hcm.manager@example.com', 'active'),
  (3012, 'workflow.us.manager', 'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Workflow US Manager', 'US-NYC-MANAGER-3012', 'workflow.us.manager@example.com', 'active'),
  (3013, 'workflow.hcm.cashier', 'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Workflow HCM Cashier', 'VN-HCM-CASHIER-3013', 'workflow.hcm.cashier@example.com', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT
  3010,
  r.code,
  o.id
FROM core.role r
CROSS JOIN core.outlet o
UNION ALL
SELECT 3011, 'outlet_manager', 2000
UNION ALL
SELECT 3011, 'outlet_manager', 2002
UNION ALL
SELECT 3012, 'outlet_manager', 2001
UNION ALL
SELECT 3012, 'outlet_manager', 2003
UNION ALL
SELECT 3013, 'cashier', 2000
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

INSERT INTO core.promotion (
  id,
  name,
  promo_type,
  status,
  value_amount,
  value_percent,
  min_order_amount,
  max_discount_amount,
  effective_from,
  effective_to
)
VALUES
  (
    9400,
    'HCM Coffee Happy Hour',
    'percentage',
    'active',
    NULL,
    10.00,
    50000.00,
    15000.00,
    TIMESTAMPTZ '2026-03-01 00:00:00+07',
    TIMESTAMPTZ '2026-04-30 23:59:59+07'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.promotion_scope (promotion_id, outlet_id)
VALUES
  (9400, 2000),
  (9400, 2002)
ON CONFLICT (promotion_id, outlet_id) DO NOTHING;

INSERT INTO core.product_outlet_availability (product_id, outlet_id, is_available)
VALUES
  (5000, 2001, TRUE),
  (5000, 2003, TRUE),
  (5000, 2004, TRUE),
  (5001, 2001, TRUE),
  (5001, 2003, TRUE),
  (5001, 2004, TRUE)
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
  (5000, 2001, 'USD', 4.50, DATE '2024-03-01', 3010, 3010),
  (5000, 2003, 'USD', 5.00, DATE '2024-07-01', 3010, 3010),
  (5000, 2004, 'VND', 62000.00, DATE '2024-05-01', 3010, 3010),
  (5001, 2001, 'USD', 3.95, DATE '2024-03-01', 3010, 3010),
  (5001, 2003, 'USD', 4.25, DATE '2024-07-01', 3010, 3010),
  (5001, 2004, 'VND', 54000.00, DATE '2024-05-01', 3010, 3010)
ON CONFLICT (product_id, outlet_id, effective_from) DO NOTHING;

INSERT INTO core.tax_rate (
  region_id,
  product_id,
  tax_percent,
  effective_from,
  effective_to
)
VALUES
  (1001, 5000, 10.00, DATE '2024-01-01', NULL),
  (1001, 5001, 8.00, DATE '2024-01-01', NULL),
  (1003, 5000, 8.00, DATE '2024-05-01', NULL),
  (1003, 5001, 8.00, DATE '2024-05-01', NULL),
  (1004, 5000, 8.75, DATE '2024-07-01', NULL),
  (1004, 5001, 8.75, DATE '2024-07-01', NULL)
ON CONFLICT (region_id, product_id, effective_from) DO NOTHING;

INSERT INTO core.inventory_transaction (
  id,
  outlet_id,
  item_id,
  qty_change,
  business_date,
  txn_time,
  txn_type,
  unit_cost,
  created_by_user_id
)
VALUES
  (9500, 2001, 4000, 25.0000, DATE '2024-07-01', TIMESTAMPTZ '2024-07-01 07:00:00-04', 'purchase_in', 10.0000, 3012),
  (9501, 2001, 4001, 20000.0000, DATE '2024-07-01', TIMESTAMPTZ '2024-07-01 07:00:00-04', 'purchase_in', 0.0010, 3012),
  (9502, 2003, 4000, 20.0000, DATE '2024-07-01', TIMESTAMPTZ '2024-07-01 07:30:00-04', 'purchase_in', 10.0000, 3012),
  (9503, 2003, 4001, 15000.0000, DATE '2024-07-01', TIMESTAMPTZ '2024-07-01 07:30:00-04', 'purchase_in', 0.0010, 3012),
  (9504, 2004, 4000, 30.0000, DATE '2024-07-01', TIMESTAMPTZ '2024-07-01 07:00:00+07', 'purchase_in', 250000.0000, 3010),
  (9505, 2004, 4001, 30000.0000, DATE '2024-07-01', TIMESTAMPTZ '2024-07-01 07:00:00+07', 'purchase_in', 0.0200, 3010)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.supplier_payment (
  id,
  supplier_id,
  currency_code,
  payment_method,
  amount,
  status,
  payment_time,
  transaction_ref,
  note,
  created_by_user_id
)
VALUES
  (
    8300,
    6000,
    'VND',
    'bank_transfer',
    1200000.00,
    'posted',
    TIMESTAMPTZ '2026-03-29 08:30:00+07',
    'PAY-8200',
    'Seeded supplier payment for procurement read coverage',
    3010
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.supplier_payment_allocation (
  payment_id,
  invoice_id,
  allocated_amount,
  note
)
VALUES
  (8300, 8200, 1200000.00, 'Fully allocated seeded payment')
ON CONFLICT (payment_id, invoice_id) DO NOTHING;

INSERT INTO core.payroll_period (
  id,
  region_id,
  name,
  start_date,
  end_date,
  pay_date,
  note
)
VALUES
  (
    9700,
    1001,
    '2026-03 HCM Payroll',
    DATE '2026-03-01',
    DATE '2026-03-31',
    DATE '2026-04-05',
    'Seeded payroll period for frontend read coverage'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.payroll_timesheet (
  id,
  payroll_period_id,
  user_id,
  outlet_id,
  work_days,
  work_hours,
  overtime_hours,
  overtime_rate,
  late_count,
  absent_days,
  approved_by_user_id
)
VALUES
  (
    9701,
    9700,
    3011,
    2000,
    26.00,
    208.00,
    6.00,
    1.50,
    1,
    0.00,
    3010
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.payroll (
  id,
  payroll_timesheet_id,
  currency_code,
  base_salary_amount,
  net_salary,
  status,
  approved_by_user_id,
  approved_at,
  payment_ref,
  note
)
VALUES
  (
    9702,
    9701,
    'VND',
    18000000.00,
    19200000.00,
    'approved',
    3010,
    TIMESTAMPTZ '2026-04-05 09:00:00+07',
    'PAYROLL-2026-03-HCM',
    'Seeded payroll run for admin frontend coverage'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
