BEGIN;

INSERT INTO core.supplier_procurement (
  id,
  region_id,
  supplier_code,
  name,
  status
)
VALUES
  (6000, 1000, 'SUP-COFFEE-001', 'Global Coffee Supply', 'active')
ON CONFLICT (id) DO NOTHING;

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
VALUES
  (7000, 6000, 2000, 'VND', DATE '2024-03-01', DATE '2024-03-03', 1200000.00, 'approved', 3001)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.purchase_order_item (
  po_id,
  item_id,
  uom_code,
  expected_unit_price,
  qty_ordered,
  qty_received,
  status
)
VALUES
  (7000, 4000, 'kg', 250000.0000, 4.0000, 4.0000, 'completed'),
  (7000, 4001, 'ml', 0.0500, 10000.0000, 10000.0000, 'completed')
ON CONFLICT (po_id, item_id) DO NOTHING;

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
VALUES
  (8000, 7000, 'VND', TIMESTAMPTZ '2024-03-03 09:00:00+07', DATE '2024-03-03', 'posted', 1200000.00, 3001)
ON CONFLICT (id) DO NOTHING;

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
VALUES
  (8100, 8000, 7000, 4000, 'kg', 4.0000, 250000.0000, 1000000.00),
  (8101, 8000, 7000, 4001, 'ml', 10000.0000, 0.0200, 200000.00)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.supplier_invoice (
  id,
  invoice_number,
  supplier_id,
  currency_code,
  invoice_date,
  due_date,
  subtotal,
  tax_amount,
  total_amount,
  status,
  created_by_user_id
)
VALUES
  (8200, 'INV-2024-0001', 6000, 'VND', DATE '2024-03-03', DATE '2024-03-10', 1200000.00, 0.00, 1200000.00, 'approved', 3001)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.supplier_invoice_receipt (invoice_id, receipt_id)
VALUES
  (8200, 8000)
ON CONFLICT (invoice_id, receipt_id) DO NOTHING;

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
VALUES
  (8200, 1, 'stock', 8100, 'Coffee Bean', 4.0000, 250000.0000, 0.00, 0.00, 1000000.00),
  (8200, 2, 'stock', 8101, 'Fresh Milk', 10000.0000, 0.0200, 0.00, 0.00, 200000.00)
ON CONFLICT (invoice_id, line_number) DO NOTHING;

COMMIT;
