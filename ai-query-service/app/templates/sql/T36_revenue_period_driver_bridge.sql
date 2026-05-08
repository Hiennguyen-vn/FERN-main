SELECT
    sumIf(net_revenue, business_date BETWEEN toDate('{{ from_date_a }}') AND toDate('{{ to_date_a }}')) AS net_revenue_a,
    sumIf(gross_revenue, business_date BETWEEN toDate('{{ from_date_a }}') AND toDate('{{ to_date_a }}')) AS gross_revenue_a,
    sumIf(txn_count, business_date BETWEEN toDate('{{ from_date_a }}') AND toDate('{{ to_date_a }}')) AS txn_count_a,
    countDistinctIf(outlet_id, business_date BETWEEN toDate('{{ from_date_a }}') AND toDate('{{ to_date_a }}')) AS outlet_count_a,
    sumIf(net_revenue, business_date BETWEEN toDate('{{ from_date_b }}') AND toDate('{{ to_date_b }}')) AS net_revenue_b,
    sumIf(gross_revenue, business_date BETWEEN toDate('{{ from_date_b }}') AND toDate('{{ to_date_b }}')) AS gross_revenue_b,
    sumIf(txn_count, business_date BETWEEN toDate('{{ from_date_b }}') AND toDate('{{ to_date_b }}')) AS txn_count_b,
    countDistinctIf(outlet_id, business_date BETWEEN toDate('{{ from_date_b }}') AND toDate('{{ to_date_b }}')) AS outlet_count_b
FROM analytics.ai_sales_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN least(
    toDate('{{ from_date_a }}'),
    toDate('{{ from_date_b }}')
  ) AND greatest(
    toDate('{{ to_date_a }}'),
    toDate('{{ to_date_b }}')
  )
LIMIT 1000
