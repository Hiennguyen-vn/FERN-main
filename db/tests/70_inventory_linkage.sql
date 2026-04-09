BEGIN;

/* =========================================================
   Setup: currency, region, outlet, user, items, categories
   ========================================================= */

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES ('IL0', 'Inventory Linkage Currency', 'I', 2);

INSERT INTO core.region (
  id, code, currency_code, name, timezone_name
)
VALUES (970000, 'IL-ROOT', 'IL0', 'Inventory Linkage Region', 'Asia/Ho_Chi_Minh');

INSERT INTO core.outlet (
  id, region_id, code, name, status, opened_at
)
VALUES (970001, 970000, 'IL-ROOT-001', 'Inventory Linkage Outlet', 'active', DATE '2025-01-01');

INSERT INTO core.app_user (
  id, username, password_hash, full_name, employee_code
)
VALUES (970100, 'inv.linkage', 'hash', 'Inventory Linkage User', 'IL-EMP-001');

INSERT INTO core.item_category (code, name)
VALUES ('il-raw', 'IL Raw Material');

INSERT INTO core.product_category (code, name)
VALUES ('il-product', 'IL Product');

INSERT INTO core.unit_of_measure (code, name)
VALUES ('g', 'Gram')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.item (
  id, code, name, category_code, base_uom_code
)
VALUES (970200, 'IL-BEAN', 'IL Coffee Bean', 'il-raw', 'g');

INSERT INTO core.product (
  id, code, name, category_code, status, created_by_user_id, updated_by_user_id
)
VALUES (970201, 'IL-LATTE', 'IL Latte', 'il-product', 'active', 970100, 970100);

/* =========================================================
   Test: inventory_transaction sign check (positive case)
   purchase_in with positive qty_change should succeed
   ========================================================= */

INSERT INTO core.inventory_transaction (
  id, outlet_id, item_id, qty_change,
  business_date, txn_time, txn_type,
  unit_cost, created_by_user_id
)
VALUES (
  970300, 970001, 970200, 100.0000,
  DATE '2025-03-15', TIMESTAMPTZ '2025-03-15 09:00:00+07', 'purchase_in',
  1.2500, 970100
);

SELECT test_support.assert_equals_numeric(
  (SELECT qty_on_hand FROM core.stock_balance WHERE location_id = 970001 AND item_id = 970200),
  100.0000,
  'purchase_in with positive qty_change should update stock'
);

/* =========================================================
   Test: inventory_transaction sign check (negative case)
   purchase_in with negative qty_change should be rejected
   ========================================================= */

DO $$
BEGIN
  BEGIN
    INSERT INTO core.inventory_transaction (
      id, outlet_id, item_id, qty_change,
      business_date, txn_time, txn_type,
      unit_cost, created_by_user_id
    )
    VALUES (
      970301, 970001, 970200, -50.0000,
      DATE '2025-03-15', TIMESTAMPTZ '2025-03-15 09:05:00+07', 'purchase_in',
      1.2500, 970100
    );

    RAISE EXCEPTION 'expected chk_inventory_txn_sign failure for negative purchase_in';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

/* =========================================================
   Test: sale_usage with negative qty_change should succeed
   ========================================================= */

INSERT INTO core.inventory_transaction (
  id, outlet_id, item_id, qty_change,
  business_date, txn_time, txn_type,
  created_by_user_id
)
VALUES (
  970302, 970001, 970200, -18.0000,
  DATE '2025-03-15', TIMESTAMPTZ '2025-03-15 10:00:00+07', 'sale_usage',
  970100
);

SELECT test_support.assert_equals_numeric(
  (SELECT qty_on_hand FROM core.stock_balance WHERE location_id = 970001 AND item_id = 970200),
  82.0000,
  'sale_usage with negative qty_change should deduct stock'
);

/* =========================================================
   Test: oversell should still be rejected even after valid deltas
   ========================================================= */

DO $$
BEGIN
  BEGIN
    INSERT INTO core.inventory_transaction (
      id, outlet_id, item_id, qty_change,
      business_date, txn_time, txn_type,
      created_by_user_id
    )
    VALUES (
      9703021, 970001, 970200, -90.0000,
      DATE '2025-03-15', TIMESTAMPTZ '2025-03-15 10:02:00+07', 'sale_usage',
      970100
    );

    RAISE EXCEPTION 'expected negative stock prevention failure for oversell';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

/* =========================================================
   Test: sale_usage with positive qty_change should be rejected
   ========================================================= */

DO $$
BEGIN
  BEGIN
    INSERT INTO core.inventory_transaction (
      id, outlet_id, item_id, qty_change,
      business_date, txn_time, txn_type,
      created_by_user_id
    )
    VALUES (
      970303, 970001, 970200, 10.0000,
      DATE '2025-03-15', TIMESTAMPTZ '2025-03-15 10:05:00+07', 'sale_usage',
      970100
    );

    RAISE EXCEPTION 'expected chk_inventory_txn_sign failure for positive sale_usage';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

/* =========================================================
   Test: waste_record FK linkage
   ========================================================= */

INSERT INTO core.inventory_transaction (
  id, outlet_id, item_id, qty_change,
  business_date, txn_time, txn_type,
  created_by_user_id
)
VALUES (
  970304, 970001, 970200, -5.0000,
  DATE '2025-03-15', TIMESTAMPTZ '2025-03-15 11:00:00+07', 'waste_out',
  970100
);

INSERT INTO core.waste_record (
  inventory_transaction_id, reason, approved_by_user_id
)
VALUES (970304, 'Spoiled beans', 970100);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.waste_record WHERE inventory_transaction_id = 970304$$,
  1,
  'waste_record should link to waste_out inventory transaction'
);

/* =========================================================
   Test: goods_receipt_transaction uniqueness
   ========================================================= */

INSERT INTO core.supplier_procurement (
  id, region_id, supplier_code, name, status
)
VALUES (970400, 970000, 'SUP-IL-001', 'IL Supplier', 'active');

INSERT INTO core.purchase_order (
  id, supplier_id, outlet_id, currency_code,
  order_date, expected_total, status, created_by_user_id
)
VALUES (970401, 970400, 970001, 'IL0', DATE '2025-03-01', 100.00, 'approved', 970100);

INSERT INTO core.purchase_order_item (
  po_id, item_id, uom_code, expected_unit_price,
  qty_ordered, qty_received, status
)
VALUES (970401, 970200, 'g', 1.2500, 80.0000, 80.0000, 'completed');

INSERT INTO core.goods_receipt (
  id, po_id, currency_code, receipt_time,
  business_date, status, total_price, created_by_user_id
)
VALUES (
  970500, 970401, 'IL0',
  TIMESTAMPTZ '2025-03-02 09:00:00+07', DATE '2025-03-02',
  'posted', 100.00, 970100
);

INSERT INTO core.goods_receipt_item (
  id, receipt_id, po_id, item_id, uom_code,
  qty_received, unit_cost, line_total
)
VALUES (970501, 970500, 970401, 970200, 'g', 80.0000, 1.2500, 100.00);

INSERT INTO core.inventory_transaction (
  id, outlet_id, item_id, qty_change,
  business_date, txn_time, txn_type,
  unit_cost, created_by_user_id
)
VALUES (
  970305, 970001, 970200, 80.0000,
  DATE '2025-03-02', TIMESTAMPTZ '2025-03-02 09:30:00+07', 'purchase_in',
  1.2500, 970100
);

INSERT INTO core.goods_receipt_transaction (
  inventory_transaction_id, goods_receipt_item_id
)
VALUES (970305, 970501);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.inventory_transaction (
      id, outlet_id, item_id, qty_change,
      business_date, txn_time, txn_type,
      unit_cost, created_by_user_id
    )
    VALUES (
      970306, 970001, 970200, 80.0000,
      DATE '2025-03-02', TIMESTAMPTZ '2025-03-02 09:35:00+07', 'purchase_in',
      1.2500, 970100
    );

    INSERT INTO core.goods_receipt_transaction (
      inventory_transaction_id, goods_receipt_item_id
    )
    VALUES (970306, 970501);

    RAISE EXCEPTION 'expected goods_receipt_transaction unique violation';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

/* =========================================================
   Test: manufacturing_transaction FK linkage
   ========================================================= */

INSERT INTO core.manufacturing_batch (
  id, outlet_id, reference_code, business_date,
  created_by_user_id
)
VALUES (970600, 970001, 'MFG-IL-001', DATE '2025-03-15', 970100);

INSERT INTO core.inventory_transaction (
  id, outlet_id, item_id, qty_change,
  business_date, txn_time, txn_type,
  created_by_user_id
)
VALUES (
  970307, 970001, 970200, -18.0000,
  DATE '2025-03-15', TIMESTAMPTZ '2025-03-15 14:00:00+07', 'manufacture_out',
  970100
);

INSERT INTO core.manufacturing_transaction (
  inventory_transaction_id, manufacturing_batch_id
)
VALUES (970307, 970600);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.manufacturing_transaction WHERE inventory_transaction_id = 970307$$,
  1,
  'manufacturing_transaction should link to manufacturing batch'
);

/* =========================================================
   Test: inventory_adjustment from stock_count
   ========================================================= */

INSERT INTO core.stock_count_session (
  id, location_id, count_date, status, counted_by_user_id
)
VALUES (970700, 970001, DATE '2025-03-15', 'approved', 970100);

INSERT INTO core.stock_count_line (
  id, stock_count_session_id, item_id, system_qty, actual_qty
)
VALUES (970701, 970700, 970200, 244.0000, 240.0000);

SELECT test_support.assert_equals_numeric(
  (SELECT variance_qty FROM core.stock_count_line WHERE id = 970701),
  -4.0000,
  'variance_qty should be actual - system'
);

INSERT INTO core.inventory_transaction (
  id, outlet_id, item_id, qty_change,
  business_date, txn_time, txn_type,
  created_by_user_id
)
VALUES (
  970308, 970001, 970200, -4.0000,
  DATE '2025-03-15', TIMESTAMPTZ '2025-03-15 18:00:00+07', 'stock_adjustment_out',
  970100
);

INSERT INTO core.inventory_adjustment (
  inventory_transaction_id, stock_count_line_id, reason, approved_by_user_id
)
VALUES (970308, 970701, 'Stock count variance adjustment', 970100);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.inventory_adjustment WHERE inventory_transaction_id = 970308 AND stock_count_line_id = 970701$$,
  1,
  'inventory_adjustment should link stock_count_line to inventory transaction'
);

/* =========================================================
   Test: sale_item_transaction links inventory usage per item
   ========================================================= */

INSERT INTO core.sale_record (
  id, outlet_id, currency_code, order_type, status, payment_status,
  subtotal, discount, tax_amount, total_amount
)
VALUES (
  970800, 970001, 'IL0', 'dine_in', 'payment_done', 'paid',
  25.00, 0.00, 0.00, 25.00
);

INSERT INTO core.sale_item (
  sale_id, product_id, unit_price, qty, discount_amount, tax_amount, line_total
)
VALUES (
  970800, 970201, 25.00, 1.0000, 0.00, 0.00, 25.00
);

INSERT INTO core.sale_item_transaction (
  inventory_transaction_id, sale_id, product_id, item_id
)
VALUES (970302, 970800, 970201, 970200);

SELECT test_support.assert_row_count(
  $$SELECT 1 FROM core.sale_item_transaction WHERE sale_id = 970800 AND product_id = 970201 AND item_id = 970200$$,
  1,
  'sale_item_transaction should store the consumed item linkage'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.sale_item_transaction (
      inventory_transaction_id, sale_id, product_id, item_id
    )
    VALUES (970307, 970800, 970201, 970200);

    RAISE EXCEPTION 'expected sale_item_transaction unique violation';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

ROLLBACK;
