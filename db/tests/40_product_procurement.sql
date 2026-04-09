BEGIN;

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES ('PR0', 'Procurement Currency', 'P', 2);

INSERT INTO core.region (
  id,
  code,
  currency_code,
  name,
  timezone_name
)
VALUES (
  940000,
  'PR-ROOT',
  'PR0',
  'Procurement Region',
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
  940001,
  940000,
  'PR-ROOT-001',
  'Procurement Outlet',
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
  940100,
  'proc.manager',
  'hash',
  'Procurement Manager',
  'PR-EMP-001'
);

INSERT INTO core.item_category (code, name)
VALUES ('raw', 'Raw Material');

INSERT INTO core.product_category (code, name)
VALUES ('drink', 'Drink');

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
  940200,
  'BEAN',
  'Coffee Bean',
  'raw',
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
  940201,
  'ESPRESSO',
  'Espresso',
  'drink',
  'active',
  940100,
  940100
);

INSERT INTO core.recipe (
  product_id,
  version,
  yield_qty,
  yield_uom_code,
  status,
  created_by_user_id
)
VALUES (
  940201,
  'v1',
  1.0000,
  'cup',
  'active',
  940100
);

INSERT INTO core.recipe_item (
  product_id,
  version,
  item_id,
  uom_code,
  qty
)
VALUES (
  940201,
  'v1',
  940200,
  'g',
  18.0000
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.recipe_item (
      product_id,
      version,
      item_id,
      uom_code,
      qty
    )
    VALUES (
      940201,
      'v1',
      940200,
      'g',
      20.0000
    );

    RAISE EXCEPTION 'expected duplicate recipe item failure';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.supplier_procurement (
  id,
  region_id,
  supplier_code,
  name,
  status
)
VALUES (
  940300,
  940000,
  'SUP-PR-001',
  'Procurement Supplier',
  'active'
);

INSERT INTO core.purchase_order (
  id,
  supplier_id,
  outlet_id,
  currency_code,
  order_date,
  expected_delivery_date,
  expected_total,
  status,
  created_by_user_id
)
VALUES (
  940400,
  940300,
  940001,
  'PR0',
  DATE '2025-03-01',
  DATE '2025-03-02',
  100.00,
  'approved',
  940100
);

INSERT INTO core.purchase_order_item (
  po_id,
  item_id,
  uom_code,
  expected_unit_price,
  qty_ordered,
  qty_received,
  status
)
VALUES (
  940400,
  940200,
  'g',
  1.2500,
  80.0000,
  80.0000,
  'completed'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.purchase_order_item (
      po_id,
      item_id,
      uom_code,
      expected_unit_price,
      qty_ordered,
      qty_received,
      status
    )
    VALUES (
      940400,
      940200,
      'g',
      1.3000,
      10.0000,
      0.0000,
      'open'
    );

    RAISE EXCEPTION 'expected duplicate po line failure';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.goods_receipt (
  id,
  po_id,
  currency_code,
  receipt_time,
  business_date,
  status,
  total_price,
  created_by_user_id
)
VALUES (
  940500,
  940400,
  'PR0',
  TIMESTAMPTZ '2025-03-02 09:00:00+07',
  DATE '2025-03-02',
  'posted',
  100.00,
  940100
);

INSERT INTO core.goods_receipt_item (
  id,
  receipt_id,
  po_id,
  item_id,
  uom_code,
  qty_received,
  unit_cost,
  line_total
)
VALUES (
  940501,
  940500,
  940400,
  940200,
  'g',
  80.0000,
  1.2500,
  100.00
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.supplier_invoice (
      id,
      invoice_number,
      supplier_id,
      currency_code,
      invoice_date,
      subtotal,
      tax_amount,
      total_amount,
      status,
      created_by_user_id
    )
    VALUES (
      940600,
      'INV-PR-FAIL',
      940300,
      'PR0',
      DATE '2025-03-02',
      100.00,
      0.00,
      100.00,
      'draft',
      940100
    );

    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'expected invoice receipt linkage failure';
  EXCEPTION
    WHEN OTHERS THEN
      IF POSITION('must be linked to at least one goods_receipt' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

INSERT INTO core.supplier_invoice (
  id,
  invoice_number,
  supplier_id,
  currency_code,
  invoice_date,
  subtotal,
  tax_amount,
  total_amount,
  status,
  created_by_user_id
)
VALUES (
  940601,
  'INV-PR-001',
  940300,
  'PR0',
  DATE '2025-03-02',
  100.00,
  0.00,
  100.00,
  'approved',
  940100
);

INSERT INTO core.supplier_invoice_receipt (invoice_id, receipt_id)
VALUES (940601, 940500);

INSERT INTO core.supplier_invoice_item (
  invoice_id,
  line_number,
  line_type,
  goods_receipt_item_id,
  description,
  qty_invoiced,
  unit_price,
  tax_percent,
  tax_amount,
  line_total
)
VALUES (
  940601,
  1,
  'stock',
  940501,
  'Coffee Bean',
  80.0000,
  1.2500,
  0.00,
  0.00,
  100.00
);

INSERT INTO core.supplier_payment (
  id,
  supplier_id,
  currency_code,
  payment_method,
  amount,
  status,
  payment_time,
  created_by_user_id
)
VALUES (
  940700,
  940300,
  'PR0',
  'bank_transfer',
  100.00,
  'posted',
  TIMESTAMPTZ '2025-03-05 09:00:00+07',
  940100
);

INSERT INTO core.supplier_payment_allocation (
  payment_id,
  invoice_id,
  allocated_amount
)
VALUES (
  940700,
  940601,
  60.00
);

DO $$
BEGIN
  BEGIN
    UPDATE core.supplier_payment_allocation
    SET allocated_amount = 120.00
    WHERE payment_id = 940700
      AND invoice_id = 940601;

    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'expected over-allocation failure';
  EXCEPTION
    WHEN OTHERS THEN
      IF POSITION('allocations exceed' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;
