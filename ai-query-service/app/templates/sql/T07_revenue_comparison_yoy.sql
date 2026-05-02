SELECT
    sumIf(net_revenue, business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}'))                        AS revenue_current,
    sumIf(net_revenue, business_date BETWEEN addYears(toDate('{{ from_date }}'), -1) AND addYears(toDate('{{ to_date }}'), -1)) AS revenue_last_year,
    sumIf(txn_count,   business_date BETWEEN toDate('{{ from_date }}') AND toDate('{{ to_date }}'))                        AS txn_current,
    sumIf(txn_count,   business_date BETWEEN addYears(toDate('{{ from_date }}'), -1) AND addYears(toDate('{{ to_date }}'), -1)) AS txn_last_year
FROM analytics.fct_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN addYears(toDate('{{ from_date }}'), -1) AND toDate('{{ to_date }}')
