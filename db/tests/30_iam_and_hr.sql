BEGIN;

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES ('HR0', 'HR Currency', 'H', 2);

INSERT INTO core.region (
  id,
  code,
  currency_code,
  name,
  timezone_name
)
VALUES (
  930000,
  'HR-ROOT',
  'HR0',
  'HR Root',
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
  930001,
  930000,
  'HR-ROOT-001',
  'HR Outlet',
  'active',
  DATE '2025-01-01'
);

INSERT INTO core.role (code, name)
VALUES ('hr_manager', 'HR Manager');

INSERT INTO core.permission (code, name)
VALUES ('hr.schedule', 'Manage Shift Schedule');

INSERT INTO core.role_permission (role_code, permission_code)
VALUES ('hr_manager', 'hr.schedule');

INSERT INTO core.app_user (
  id,
  username,
  password_hash,
  full_name,
  employee_code
)
VALUES
  (930100, 'hr.manager', 'hash', 'HR Manager', 'HR-EMP-001'),
  (930101, 'hr.staff', 'hash', 'HR Staff', 'HR-EMP-002');

INSERT INTO core.user_role (user_id, role_code, outlet_id)
VALUES (930100, 'hr_manager', 930001);

INSERT INTO core.user_permission (user_id, permission_code, outlet_id)
VALUES (930101, 'hr.schedule', 930001);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.user_role WHERE user_id = 930100 AND role_code = 'hr_manager' AND outlet_id = 930001$$,
  1,
  'user_role ternary assignment should persist'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.shift (
      id,
      outlet_id,
      code,
      name,
      start_time,
      end_time
    )
    VALUES (
      930200,
      930001,
      'BAD-SHIFT',
      'Broken Shift',
      TIME '18:00',
      TIME '08:00'
    );

    RAISE EXCEPTION 'expected shift time check failure';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.shift (
  id,
  outlet_id,
  code,
  name,
  start_time,
  end_time,
  break_minutes
)
VALUES (
  930201,
  930001,
  'AM',
  'Morning Shift',
  TIME '08:00',
  TIME '16:00',
  30
);

INSERT INTO core.work_shift (
  id,
  shift_id,
  user_id,
  work_date,
  schedule_status,
  attendance_status,
  approval_status,
  assigned_by_user_id
)
VALUES (
  930300,
  930201,
  930101,
  DATE '2025-03-01',
  'scheduled',
  'pending',
  'pending',
  930100
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.work_shift (
      id,
      shift_id,
      user_id,
      work_date,
      schedule_status,
      attendance_status,
      approval_status,
      assigned_by_user_id
    )
    VALUES (
      930301,
      930201,
      930101,
      DATE '2025-03-01',
      'scheduled',
      'pending',
      'pending',
      930100
    );

    RAISE EXCEPTION 'expected duplicate work shift failure';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.employee_contract (
  id,
  user_id,
  employment_type,
  salary_type,
  base_salary,
  currency_code,
  region_code,
  start_date,
  status,
  created_by_user_id
)
VALUES
  (930400, 930101, 'full_time', 'monthly', 1000.00, 'HR0', 'HR-ROOT', DATE '2025-01-01', 'active', 930100),
  (930401, 930101, 'contractor', 'hourly', 12.50, 'HR0', 'HR-ROOT', DATE '2025-02-15', 'active', 930100);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.employee_contract WHERE user_id = 930101$$,
  2,
  'overlapping employee contracts should be allowed'
);

ROLLBACK;
