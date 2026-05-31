SELECT
    business_date,
    outlet_id,
    revenue,
    actual_or_theoretical_cogs,
    goods_receipt_cost,
    payroll_cost,
    expense_amount,
    gross_profit,
    operating_profit,
    margin
FROM analytics.ai_finance_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
ORDER BY business_date DESC, outlet_id
LIMIT 1000
