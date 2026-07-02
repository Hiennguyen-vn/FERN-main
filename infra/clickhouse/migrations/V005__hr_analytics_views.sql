CREATE DATABASE IF NOT EXISTS cdc;
CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS cdc.app_user (
    id UInt64,
    username Nullable(String),
    email Nullable(String),
    full_name Nullable(String),
    phone Nullable(String),
    status Nullable(String),
    employee_code Nullable(String),
    dob Nullable(Int32),
    gender Nullable(String),
    national_id Nullable(String),
    address Nullable(String),
    password_changed_at Nullable(DateTime),
    deleted_at Nullable(DateTime),
    version Nullable(Int32),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    __deleted Nullable(String),
    __op Nullable(String),
    __ts_ms Nullable(Int64),
    __lsn Nullable(Int64)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

CREATE TABLE IF NOT EXISTS cdc.shift (
    id UInt64,
    outlet_id UInt64,
    code Nullable(String),
    name String,
    start_time Nullable(Int64),
    end_time Nullable(Int64),
    break_minutes Nullable(UInt16),
    daypart Nullable(String),
    headcount_required Nullable(Int32),
    deleted_at Nullable(DateTime),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    __deleted Nullable(String),
    __op Nullable(String),
    __ts_ms Nullable(Int64),
    __lsn Nullable(Int64)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (outlet_id, id);

CREATE TABLE IF NOT EXISTS cdc.work_shift (
    id UInt64,
    shift_id UInt64,
    user_id UInt64,
    work_date Int32,
    work_role Nullable(String),
    schedule_status Nullable(String),
    attendance_status Nullable(String),
    approval_status Nullable(String),
    actual_start_time Nullable(DateTime),
    actual_end_time Nullable(DateTime),
    assigned_by_user_id Nullable(UInt64),
    approved_by_user_id Nullable(UInt64),
    note Nullable(String),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    __deleted Nullable(String),
    __op Nullable(String),
    __ts_ms Nullable(Int64),
    __lsn Nullable(Int64)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (user_id, work_date, id);

CREATE TABLE IF NOT EXISTS cdc.employee_contract (
    id UInt64,
    user_id UInt64,
    employment_type Nullable(String),
    salary_type Nullable(String),
    base_salary Nullable(Decimal(18,2)),
    currency_code Nullable(String),
    region_code Nullable(String),
    tax_code Nullable(String),
    bank_account Nullable(String),
    hire_date Nullable(Int32),
    start_date Int32,
    end_date Nullable(Int32),
    status Nullable(String),
    created_by_user_id Nullable(UInt64),
    deleted_at Nullable(DateTime),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    __deleted Nullable(String),
    __op Nullable(String),
    __ts_ms Nullable(Int64),
    __lsn Nullable(Int64)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (user_id, start_date, id);

CREATE TABLE IF NOT EXISTS cdc.payroll_period (
    id UInt64,
    region_id UInt64,
    name String,
    start_date Int32,
    end_date Int32,
    pay_date Nullable(Int32),
    note Nullable(String),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    __deleted Nullable(String),
    __op Nullable(String),
    __ts_ms Nullable(Int64),
    __lsn Nullable(Int64)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (region_id, start_date, id);

CREATE TABLE IF NOT EXISTS cdc.payroll_timesheet (
    id UInt64,
    payroll_period_id UInt64,
    user_id UInt64,
    outlet_id Nullable(UInt64),
    work_days Nullable(Decimal(10,2)),
    work_hours Nullable(Decimal(10,2)),
    overtime_hours Nullable(Decimal(10,2)),
    overtime_rate Nullable(Decimal(5,2)),
    late_count Nullable(Int32),
    absent_days Nullable(Decimal(10,2)),
    approved_by_user_id Nullable(UInt64),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    __deleted Nullable(String),
    __op Nullable(String),
    __ts_ms Nullable(Int64),
    __lsn Nullable(Int64)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (payroll_period_id, user_id, id);

CREATE TABLE IF NOT EXISTS cdc.payroll (
    id UInt64,
    payroll_timesheet_id UInt64,
    currency_code Nullable(String),
    base_salary_amount Nullable(Decimal(18,2)),
    net_salary Nullable(Decimal(18,2)),
    status Nullable(String),
    approved_by_user_id Nullable(UInt64),
    approved_at Nullable(DateTime),
    payment_ref Nullable(String),
    note Nullable(String),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    __deleted Nullable(String),
    __op Nullable(String),
    __ts_ms Nullable(Int64),
    __lsn Nullable(Int64)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (payroll_timesheet_id, id);

DROP VIEW IF EXISTS analytics.ai_hr_active_employee_daily;

CREATE OR REPLACE VIEW analytics.ai_hr_active_employee_daily AS
WITH contract_latest AS (
    SELECT
        user_id,
        argMax(id, tuple(start_date, coalesce(updated_at, created_at))) AS contract_id,
        argMax(status, tuple(start_date, coalesce(updated_at, created_at))) AS contract_status,
        argMax(employment_type, tuple(start_date, coalesce(updated_at, created_at))) AS employment_type,
        argMax(salary_type, tuple(start_date, coalesce(updated_at, created_at))) AS salary_type,
        argMax(start_date, tuple(start_date, coalesce(updated_at, created_at))) AS contract_start_date,
        argMax(end_date, tuple(start_date, coalesce(updated_at, created_at))) AS contract_end_date,
        max(coalesce(updated_at, created_at)) AS contract_updated_at
    FROM cdc.employee_contract FINAL
    WHERE coalesce(__deleted, 'false') = 'false'
    GROUP BY user_id
),
shift_daily AS (
    SELECT
        ws.user_id,
        s.outlet_id,
        ws.work_date AS as_of_date,
        max(ws.id) AS shift_id,
        argMax(ws.schedule_status, ws.updated_at) AS schedule_status,
        argMax(ws.attendance_status, ws.updated_at) AS attendance_status,
        argMax(ws.approval_status, ws.updated_at) AS approval_status,
        max(ws.work_date) OVER (PARTITION BY ws.user_id) AS latest_work_date
    FROM (SELECT * FROM cdc.work_shift FINAL) AS ws
    INNER JOIN (SELECT * FROM cdc.shift FINAL) AS s ON ws.shift_id = s.id
    WHERE coalesce(ws.__deleted, 'false') = 'false'
      AND coalesce(s.__deleted, 'false') = 'false'
    GROUP BY
        ws.user_id,
        s.outlet_id,
        ws.work_date
),
base_dates AS (
    SELECT
        cl.user_id,
        sd.outlet_id,
        coalesce(sd.as_of_date, cl.contract_start_date) AS as_of_date
    FROM contract_latest AS cl
    LEFT JOIN shift_daily AS sd ON cl.user_id = sd.user_id
)
SELECT
    bd.user_id AS employee_id,
    coalesce(nullIf(au.full_name, ''), concat('Employee ', toString(bd.user_id))) AS employee_name,
    bd.outlet_id AS outlet_id,
    multiIf(
        cl.contract_status IN ('terminated', 'expired'), cl.contract_status,
        cl.contract_start_date > bd.as_of_date, 'draft',
        cl.contract_end_date IS NOT NULL AND cl.contract_end_date < bd.as_of_date, 'expired',
        sd.approval_status = 'rejected', 'inactive',
        sd.schedule_status = 'cancelled', 'inactive',
        'active'
    ) AS status,
    toUInt8(
        cl.contract_status = 'active'
        AND cl.contract_start_date <= bd.as_of_date
        AND (cl.contract_end_date IS NULL OR cl.contract_end_date >= bd.as_of_date)
        AND coalesce(sd.schedule_status, 'scheduled') != 'cancelled'
        AND coalesce(sd.approval_status, 'approved') != 'rejected'
    ) AS is_active,
    bd.as_of_date AS as_of_date,
    sd.shift_id AS shift_id,
    cl.employment_type AS employment_type,
    cl.salary_type AS salary_type,
    cl.contract_start_date AS contract_start_date,
    cl.contract_end_date AS contract_end_date,
    toUInt8(sd.shift_id IS NOT NULL) AS has_shift_assignment,
    sd.latest_work_date AS latest_work_date
FROM base_dates bd
INNER JOIN contract_latest cl ON bd.user_id = cl.user_id
LEFT JOIN shift_daily sd
    ON bd.user_id = sd.user_id
   AND bd.outlet_id = sd.outlet_id
   AND bd.as_of_date = sd.as_of_date
LEFT JOIN (SELECT * FROM cdc.app_user FINAL) AS au ON bd.user_id = au.id
WHERE bd.as_of_date IS NOT NULL
  AND coalesce(au.__deleted, 'false') = 'false';
