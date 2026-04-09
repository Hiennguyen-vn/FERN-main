BEGIN;

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES ('FN0', 'Finance Currency', 'F', 2);

INSERT INTO core.region (
  id,
  code,
  currency_code,
  name,
  timezone_name
)
VALUES (
  960000,
  'FN-ROOT',
  'FN0',
  'Finance Region',
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
  960001,
  960000,
  'FN-ROOT-001',
  'Finance Outlet',
  'active',
  DATE '2025-01-01'
);

INSERT INTO core.app_user (
  id,
  username,
  password_hash,
  full_name,
  employee_code
)
VALUES (
  960100,
  'finance.user',
  'hash',
  'Finance User',
  'FN-EMP-001'
);

INSERT INTO core.payroll_period (
  id,
  region_id,
  name,
  start_date,
  end_date,
  pay_date
)
VALUES (
  960200,
  960000,
  'March 2025 Payroll',
  DATE '2025-03-01',
  DATE '2025-03-31',
  DATE '2025-04-05'
);

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
VALUES (
  960201,
  960200,
  960100,
  960001,
  24.00,
  192.00,
  5.50,
  1.50,
  1,
  0.00,
  960100
);

INSERT INTO core.payroll (
  id,
  payroll_timesheet_id,
  currency_code,
  base_salary_amount,
  net_salary,
  status,
  approved_by_user_id
)
VALUES (
  960202,
  960201,
  'FN0',
  2500.00,
  2700.00,
  'approved',
  960100
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.payroll (
      id,
      payroll_timesheet_id,
      currency_code,
      base_salary_amount,
      net_salary,
      status
    )
    VALUES (
      960203,
      960201,
      'FN0',
      2000.00,
      2200.00,
      'draft'
    );

    RAISE EXCEPTION 'expected one-to-one payroll failure';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.expense_record (
  id,
  outlet_id,
  business_date,
  currency_code,
  amount,
  source_type,
  created_by_user_id
)
VALUES (
  960300,
  960001,
  DATE '2025-04-05',
  'FN0',
  2700.00,
  'payroll',
  960100
);

INSERT INTO core.expense_payroll (
  expense_record_id,
  payroll_id
)
VALUES (
  960300,
  960202
);

INSERT INTO core.audit_log (
  id,
  actor_user_id,
  action,
  entity_name,
  entity_id,
  reason,
  old_data,
  new_data,
  ip_address,
  user_agent
)
VALUES (
  960400,
  960100,
  'update',
  'payroll',
  '960202',
  'Approved payroll payout',
  '{"status":"draft"}'::jsonb,
  '{"status":"approved"}'::jsonb,
  '127.0.0.1',
  'psql-test'
);

SELECT test_support.assert_equals_text(
  (SELECT new_data ->> 'status' FROM core.audit_log WHERE id = 960400),
  'approved',
  'audit_log should store jsonb payloads'
);

ROLLBACK;
