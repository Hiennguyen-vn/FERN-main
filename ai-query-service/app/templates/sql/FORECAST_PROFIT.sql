SELECT
    {{ outlet_ids[0] }} AS outlet_id,
    sum(operating_profit) AS actual_operating_profit,
    sum(revenue) AS actual_revenue,
    countDistinct(business_date) AS elapsed_days,
    toDayOfMonth(toLastDayOfMonth(toDate('{{ to_date }}'))) AS month_days,
    if(elapsed_days = 0, 0, actual_operating_profit / elapsed_days) AS daily_profit_run_rate,
    daily_profit_run_rate * month_days AS projected_month_operating_profit,
    CAST(NULL, 'Nullable(Decimal(18, 2))') AS target_operating_profit,
    'no_target_table' AS target_status
FROM analytics.ai_finance_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN toStartOfMonth(toDate('{{ to_date }}')) AND toDate('{{ to_date }}')
LIMIT 1
