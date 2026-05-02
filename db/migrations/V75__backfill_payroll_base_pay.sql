-- Backfill payroll.base_salary_amount to represent base pay for the payroll period.
-- Previous generated payroll runs stored employee_contract.base_salary directly,
-- which is only a rate for hourly/daily contracts. The application now stores:
--   hourly:  work_hours * base_salary
--   daily:   work_days * base_salary
--   monthly: base_salary

UPDATE core.payroll p
SET base_salary_amount = ROUND(
      CASE
        WHEN ec.salary_type = 'daily'::salary_type_enum THEN pt.work_days * ec.base_salary
        WHEN ec.salary_type = 'monthly'::salary_type_enum THEN ec.base_salary
        ELSE pt.work_hours * ec.base_salary
      END,
      2
    ),
    updated_at = NOW()
FROM core.payroll_timesheet pt
JOIN core.payroll_period pp ON pp.id = pt.payroll_period_id
JOIN LATERAL (
  SELECT ec.salary_type, ec.base_salary, ec.currency_code
  FROM core.employee_contract ec
  WHERE ec.user_id = pt.user_id
    AND ec.status = 'active'::contract_status_enum
    AND ec.deleted_at IS NULL
    AND ec.start_date <= pp.end_date
    AND (ec.end_date IS NULL OR ec.end_date >= pp.start_date)
  ORDER BY ec.start_date DESC, ec.created_at DESC
  LIMIT 1
) ec ON TRUE
WHERE p.payroll_timesheet_id = pt.id
  AND p.currency_code = ec.currency_code
  AND p.base_salary_amount = ec.base_salary
  AND ec.salary_type <> 'monthly'::salary_type_enum;
