-- V74: Seed canonical role codes + their stored aliases.
--
-- The CanonicalRole enum uses two distinct codes: a canonical `code` (e.g. `staff`,
-- `procurement`) and a `storedRoleCode` written into `user_role.role_code`
-- (e.g. `cashier`, `procurement_officer`). Both must exist as FK targets so
-- the IAM "Invite/Assign User" flow can persist either code.

INSERT INTO core.role (code, name, description) VALUES
  ('superadmin',          'Superadmin',           'Full system access'),
  ('admin',               'Admin',                'IAM governance within scope'),
  ('region_manager',      'Region Manager',       'Operational oversight across a region'),
  ('outlet_manager',      'Outlet Manager',       'Store-level business owner'),
  ('staff',               'Staff',                'POS/cashier operator (canonical)'),
  ('cashier',             'Cashier',              'POS operator (legacy stored code for Staff)'),
  ('product_manager',     'Product Manager',      'Catalog/menu/pricing'),
  ('procurement',         'Procurement',          'Purchase order creation (canonical)'),
  ('procurement_officer', 'Procurement Officer',  'Procurement (legacy stored code)'),
  ('finance',             'Finance',              'Financial ops + payroll approve'),
  ('hr',                  'HR',                   'Contracts + scheduling + payroll prepare'),
  ('kitchen_staff',       'Kitchen Staff',        'Kitchen fulfillment')
ON CONFLICT (code) DO NOTHING;
