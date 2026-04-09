
-- Fix sale_order_items
DROP POLICY IF EXISTS "Users can create order items" ON public.sale_order_items;
DROP POLICY IF EXISTS "Users can update order items" ON public.sale_order_items;
CREATE POLICY "Users can create order items" ON public.sale_order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.sale_orders WHERE id = sale_order_items.order_id AND created_by = auth.uid()));
CREATE POLICY "Users can update order items" ON public.sale_order_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sale_orders WHERE id = sale_order_items.order_id AND created_by = auth.uid()));

-- Fix payments
DROP POLICY IF EXISTS "Users can create payments" ON public.payments;
CREATE POLICY "Users can create payments" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.sale_orders WHERE id = payments.order_id AND created_by = auth.uid()));

-- Fix stock_balances
DROP POLICY IF EXISTS "Operators can update stock balances" ON public.stock_balances;
DROP POLICY IF EXISTS "Operators can insert stock balances" ON public.stock_balances;
CREATE POLICY "Managers can update stock balances" ON public.stock_balances FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can insert stock balances" ON public.stock_balances FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));

-- Fix po_line_items
DROP POLICY IF EXISTS "Users can create PO items" ON public.po_line_items;
CREATE POLICY "Users can create PO items" ON public.po_line_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_orders WHERE id = po_line_items.po_id AND created_by = auth.uid()));

-- Fix gr_line_items
DROP POLICY IF EXISTS "Operators can create GR items" ON public.gr_line_items;
CREATE POLICY "Operators can create GR items" ON public.gr_line_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.goods_receipts WHERE id = gr_line_items.receipt_id AND received_by = auth.uid()));
