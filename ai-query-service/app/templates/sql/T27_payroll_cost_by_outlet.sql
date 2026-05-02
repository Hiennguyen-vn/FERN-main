SELECT
    outletId AS outlet_id,
    toDate(approvedAt) AS approved_date,
    sum(netSalary) AS total_payroll,
    count() AS payslip_count
FROM fern.events_payroll_approved
WHERE outletId IN ({{ outlet_ids | join(',') }})
  AND outletId IS NOT NULL
  AND toDate(approvedAt) BETWEEN '{{ from_date }}' AND '{{ to_date }}'
GROUP BY outletId, approved_date
ORDER BY approved_date DESC, total_payroll DESC
LIMIT 1000
