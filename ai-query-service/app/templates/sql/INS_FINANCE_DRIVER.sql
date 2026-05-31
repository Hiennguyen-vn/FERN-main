SELECT
    outlet_id,
    any(outlet_name) AS outlet_name,
    sumIf(operating_profit, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_operating_profit,
    sumIf(
        operating_profit,
        business_date BETWEEN
            toDate('{{ from_date }}') - (dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1))
            AND toDate('{{ from_date }}') - 1
    ) AS baseline_operating_profit,
    sumIf(revenue, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_revenue,
    sumIf(
        revenue,
        business_date BETWEEN
            toDate('{{ from_date }}') - (dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1))
            AND toDate('{{ from_date }}') - 1
    ) AS baseline_revenue,
    sumIf(goods_receipt_cost, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_goods_receipt_cost,
    sumIf(payroll_cost, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_payroll_cost,
    sumIf(expense_amount, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}')) AS current_expense_amount,
    current_operating_profit - baseline_operating_profit AS delta_operating_profit,
    if(baseline_operating_profit = 0, 0, delta_operating_profit / abs(baseline_operating_profit)) AS delta_pct,
    abs(delta_operating_profit) AS impact_abs
FROM analytics.ai_finance_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN
      toDate('{{ from_date }}') - (dateDiff('day', toDate('{{ from_date }}'), toDate('{{ to_date }}') + 1))
      AND toDate('{{ to_date }}')
GROUP BY outlet_id
HAVING current_operating_profit != 0 OR baseline_operating_profit != 0
ORDER BY impact_abs DESC
LIMIT {{ limit | default(20) }}
