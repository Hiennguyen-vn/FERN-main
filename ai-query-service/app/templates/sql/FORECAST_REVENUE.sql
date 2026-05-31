SELECT
    {{ outlet_ids[0] }} AS outlet_id,
    sum(net_revenue) AS actual_revenue,
    sum(txn_count) AS txn_count,
    countDistinct(business_date) AS elapsed_days,
    toDayOfMonth(toLastDayOfMonth(toDate('{{ to_date }}'))) AS month_days,
    if(elapsed_days = 0, 0, actual_revenue / elapsed_days) AS daily_run_rate,
    daily_run_rate * month_days AS projected_month_revenue,
    CAST(NULL, 'Nullable(Decimal(18, 2))') AS target_revenue,
    'no_target_table' AS target_status
FROM analytics.ai_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN toStartOfMonth(toDate('{{ to_date }}')) AND toDate('{{ to_date }}')
LIMIT 1
