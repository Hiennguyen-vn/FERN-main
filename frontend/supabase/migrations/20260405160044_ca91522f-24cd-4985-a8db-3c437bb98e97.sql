
-- Fix supplier_invoices: restrict insert to managers
DROP POLICY IF EXISTS "Users can create invoices" ON public.supplier_invoices;
CREATE POLICY "Managers can create invoices" ON public.supplier_invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));

-- Fix supplier_payments: restrict insert to managers  
DROP POLICY IF EXISTS "Users can create supplier payments" ON public.supplier_payments;
CREATE POLICY "Managers can create supplier payments" ON public.supplier_payments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));
