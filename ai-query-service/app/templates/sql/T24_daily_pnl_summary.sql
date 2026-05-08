SELECT
    business_date,
    outlet_id,
    revenue,
    cogs,
    payroll_cost,
    operating_profit,
    operating_margin AS margin
FROM analytics.ai_pnl_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
ORDER BY business_date DESC, outlet_id
LIMIT 1000
