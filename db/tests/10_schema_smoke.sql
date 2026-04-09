BEGIN;

SELECT test_support.assert_row_count(
  $$SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'core'$$,
  1,
  'core schema should exist'
);

SELECT test_support.assert_row_count(
  $$SELECT table_name FROM information_schema.tables WHERE table_schema = 'core' AND table_name = 'app_user'$$,
  1,
  'app_user table should exist'
);

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES ('TST', 'Test Currency', 'T', 2);

INSERT INTO core.region (
  id,
  code,
  currency_code,
  name,
  timezone_name
)
VALUES (
  910000,
  'TST-REGION',
  'TST',
  'Test Region',
  'Asia/Ho_Chi_Minh'
);

INSERT INTO core.outlet (
  id,
  region_id,
  code,
  name,
  status,
  opened_at
)
VALUES (
  910001,
  910000,
  'TST-REGION-001',
  'Test Outlet',
  'active',
  DATE '2025-01-01'
);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.outlet WHERE code = 'TST-REGION-001'$$,
  1,
  'outlet insert smoke test should succeed'
);

ROLLBACK;

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.outlet WHERE code = 'TST-REGION-001'$$,
  0,
  'rollback should remove smoke test rows'
);
