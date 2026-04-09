BEGIN;

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES ('SI0', 'Sales Currency', 'S', 2);

INSERT INTO core.region (
  id,
  code,
  currency_code,
  name,
  timezone_name
)
VALUES (
  950000,
  'SI-ROOT',
  'SI0',
  'Sales Region',
  'Asia/Ho_Chi_Minh'
);

INSERT INTO core.outlet (
  id,
  region_id,
  code,
  name,
  status,
  opened_at
)
VALUES (
  950001,
  950000,
  'SI-ROOT-001',
  'Sales Outlet',
  'active',
  DATE '2025-01-01'
);

INSERT INTO core.app_user (
  id,
  username,
  password_hash,
  full_name,
  employee_code
)
VALUES (
  950100,
  'sales.user',
  'hash',
  'Sales User',
  'SI-EMP-001'
);

INSERT INTO core.item_category (code, name)
VALUES ('sales-raw', 'Sales Raw');

INSERT INTO core.product_category (code, name)
VALUES ('sales-product', 'Sales Product');

INSERT INTO core.unit_of_measure (code, name)
VALUES
  ('g', 'Gram'),
  ('cup', 'Cup')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.item (
  id,
  code,
  name,
  category_code,
  base_uom_code
)
VALUES (
  950200,
  'SI-BEAN',
  'Sales Bean',
  'sales-raw',
  'g'
);

INSERT INTO core.product (
  id,
  code,
  name,
  category_code,
  status,
  created_by_user_id,
  updated_by_user_id
)
VALUES (
  950201,
  'SI-LATTE',
  'Sales Latte',
  'sales-product',
  'active',
  950100,
  950100
);

INSERT INTO core.pos_session (
  id,
  session_code,
  outlet_id,
  currency_code,
  manager_id,
  opened_at,
  business_date,
  status
)
VALUES (
  950300,
  'POS-SI-001',
  950001,
  'SI0',
  950100,
  TIMESTAMPTZ '2025-03-10 08:00:00+07',
  DATE '2025-03-10',
  'open'
);

INSERT INTO core.sale_record (
  id,
  outlet_id,
  pos_session_id,
  currency_code,
  order_type,
  status,
  payment_status,
  subtotal,
  discount,
  tax_amount,
  total_amount
)
VALUES (
  950400,
  950001,
  950300,
  'SI0',
  'dine_in',
  'completed',
  'paid',
  65000.00,
  5000.00,
  6000.00,
  66000.00
);

INSERT INTO core.sale_item (
  sale_id,
  product_id,
  unit_price,
  qty,
  discount_amount,
  tax_amount,
  line_total
)
VALUES (
  950400,
  950201,
  65000.00,
  1.0000,
  5000.00,
  6000.00,
  66000.00
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.sale_item (
      sale_id,
      product_id,
      unit_price,
      qty,
      discount_amount,
      tax_amount,
      line_total
    )
    VALUES (
      950400,
      950201,
      65000.00,
      2.0000,
      0.00,
      12000.00,
      142000.00
    );

    RAISE EXCEPTION 'expected duplicate sale item failure';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.payment (
  sale_id,
  pos_session_id,
  payment_method,
  amount,
  status,
  payment_time
)
VALUES (
  950400,
  950300,
  'card',
  66000.00,
  'success',
  TIMESTAMPTZ '2025-03-10 09:00:00+07'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.payment (
      sale_id,
      pos_session_id,
      payment_method,
      amount,
      status,
      payment_time
    )
    VALUES (
      950400,
      950300,
      'cash',
      66000.00,
      'success',
      TIMESTAMPTZ '2025-03-10 09:05:00+07'
    );

    RAISE EXCEPTION 'expected one-to-one payment failure';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.inventory_transaction (
  id,
  outlet_id,
  item_id,
  qty_change,
  business_date,
  txn_time,
  txn_type,
  unit_cost,
  created_by_user_id
)
VALUES (
  950500,
  950001,
  950200,
  100.0000,
  DATE '2025-03-10',
  TIMESTAMPTZ '2025-03-10 09:10:00+07',
  'purchase_in',
  1.2500,
  950100
);

SELECT test_support.assert_equals_numeric(
  (SELECT qty_on_hand FROM core.stock_balance WHERE location_id = 950001 AND item_id = 950200),
  100.0000,
  'inventory trigger should increase stock balance'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.inventory_transaction (
      id,
      outlet_id,
      item_id,
      qty_change,
      business_date,
      txn_time,
      txn_type,
      created_by_user_id
    )
    VALUES (
      950501,
      950001,
      950200,
      -101.0000,
      DATE '2025-03-10',
      TIMESTAMPTZ '2025-03-10 09:11:00+07',
      'sale_usage',
      950100
    );

    RAISE EXCEPTION 'expected negative stock prevention failure';
  EXCEPTION
    WHEN raise_exception OR check_violation THEN
      NULL;
  END;
END;
$$;

SELECT test_support.assert_equals_numeric(
  (SELECT qty_on_hand FROM core.stock_balance WHERE location_id = 950001 AND item_id = 950200),
  100.0000,
  'negative stock prevention should preserve prior balance'
);

INSERT INTO core.stock_count_session (
  id,
  location_id,
  count_date,
  status,
  counted_by_user_id
)
VALUES (
  950600,
  950001,
  DATE '2025-03-10',
  'submitted',
  950100
);

INSERT INTO core.stock_count_line (
  id,
  stock_count_session_id,
  item_id,
  system_qty,
  actual_qty
)
VALUES (
  950601,
  950600,
  950200,
  100.0000,
  97.5000
);

SELECT test_support.assert_equals_numeric(
  (SELECT variance_qty FROM core.stock_count_line WHERE id = 950601),
  -2.5000,
  'variance_qty should be generated from actual - system'
);

ROLLBACK;

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.stock_balance WHERE location_id = 950001 AND item_id = 950200$$,
  0,
  'rollback should revert trigger-maintained stock balance rows'
);
