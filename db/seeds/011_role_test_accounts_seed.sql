BEGIN;

/* =========================================================
   011_role_test_accounts_seed.sql
   Test accounts for all 10 canonical roles per business rules.
   Password for all test.* users: Workflow#2026!

   Roles & outlets:
     superadmin      → all outlets (fan-out)
     admin           → HCM outlets (2000, 2002)
     region_manager  → HCM region outlets (2000, 2002, 2004)
     outlet_manager  → single outlet (2000)  [already exists as workflow.hcm.manager]
     staff           → single outlet (2000)  [uses cashier code]
     product_manager → HCM region outlets (2000, 2002)
     procurement     → single outlet (2000)  [uses procurement_officer code]
     finance         → HCM region outlets (2000, 2002)
     hr              → HCM region outlets (2000, 2002)
     kitchen_staff   → single outlet (2000)
   ========================================================= */

-- Same password hash as workflow users: Workflow#2026!
-- Format: Base64(salt):Base64(HS256(salt + password))

INSERT INTO core.app_user (id, username, password_hash, full_name, employee_code, email, status)
VALUES
  (4001, 'test.superadmin',      'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Superadmin',      'TEST-SUPER-4001',   'test.superadmin@example.com',      'active'),
  (4002, 'test.admin',           'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Admin',           'TEST-ADMIN-4002',   'test.admin@example.com',           'active'),
  (4003, 'test.region.manager',  'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Region Manager',  'TEST-RM-4003',      'test.region.manager@example.com',  'active'),
  (4004, 'test.outlet.manager',  'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Outlet Manager',  'TEST-OM-4004',      'test.outlet.manager@example.com',  'active'),
  (4005, 'test.staff',           'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Staff',           'TEST-STAFF-4005',   'test.staff@example.com',           'active'),
  (4006, 'test.product.manager', 'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Product Manager', 'TEST-PM-4006',      'test.product.manager@example.com', 'active'),
  (4007, 'test.procurement',     'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Procurement',     'TEST-PROC-4007',    'test.procurement@example.com',     'active'),
  (4008, 'test.finance',         'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Finance',         'TEST-FIN-4008',     'test.finance@example.com',         'active'),
  (4009, 'test.hr',              'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test HR',              'TEST-HR-4009',      'test.hr@example.com',              'active'),
  (4010, 'test.kitchen',         'RkVSTldvcmtmbG93U2VlZA==:7QetsR9u6R7RCXQD74G6D9hlmHzBSmeqzB3Pv0DrmDo=', 'Test Kitchen Staff',   'TEST-KITCHEN-4010', 'test.kitchen@example.com',         'active')
ON CONFLICT (id) DO NOTHING;

-- ── Role assignments ──────────────────────────────────────

-- superadmin: fan-out to all active outlets (global scope)
INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT 4001, 'superadmin', o.id FROM core.outlet o
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- admin: HCM outlets (governance scope)
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4002, 'admin', 2000),
  (4002, 'admin', 2002)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- region_manager: all VN-HCM region outlets (region 1000 = VN, includes HCM + sub-regions)
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4003, 'region_manager', 2000),
  (4003, 'region_manager', 2002),
  (4003, 'region_manager', 2004)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- outlet_manager: single outlet
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4004, 'outlet_manager', 2000)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- staff: uses 'cashier' code (legacy alias → staff on frontend)
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4005, 'cashier', 2000)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- product_manager: region scope via fan-out
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4006, 'product_manager', 2000),
  (4006, 'product_manager', 2002)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- procurement: uses 'procurement_officer' code (legacy alias → procurement on frontend)
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4007, 'procurement_officer', 2000)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- finance: region scope via fan-out
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4008, 'finance', 2000),
  (4008, 'finance', 2002)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- hr: region scope via fan-out
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4009, 'hr', 2000),
  (4009, 'hr', 2002)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- kitchen_staff: single outlet
INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES
  (4010, 'kitchen_staff', 2000)
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

-- ── §8.1 Admin governance-only: remove business permissions ────
-- Admin should only have governance permissions, not business operations.
DELETE FROM core.role_permission
WHERE role_code = 'admin'
  AND permission_code NOT IN (
    'auth.user.write',
    'auth.role.write',
    'org.write',
    'audit.read'
  );

COMMIT;
