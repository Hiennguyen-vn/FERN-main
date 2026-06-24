SELECT
    product_id,
    any(product_name) AS product_name,
    any(category_code) AS product_category_code,
    sum(revenue) AS revenue,
    sum(qty) AS qty
FROM analytics.ai_product_daily
WHERE outlet_id IN ({{ outlet_ids | join(',') }})
  AND business_date BETWEEN '{{ from_date }}' AND '{{ to_date }}'
  {% if category_codes is defined and category_codes %}
  AND category_code IN ('{{ category_codes | join("','") }}')
  {% endif %}
GROUP BY product_id
ORDER BY {% if sort_by is defined and sort_by == 'revenue' %}revenue{% else %}qty{% endif %} DESC
LIMIT {{ limit | default(10) }}
