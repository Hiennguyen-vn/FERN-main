
-- Allow managers to create POS sessions
CREATE POLICY "Managers can create sessions"
  ON public.pos_sessions
  FOR INSERT
  TO public
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );

-- Allow managers to update any POS session
CREATE POLICY "Managers can update any session"
  ON public.pos_sessions
  FOR UPDATE
  TO public
  USING (
    has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );

-- Allow managers to delete POS sessions
CREATE POLICY "Managers can delete sessions"
  ON public.pos_sessions
  FOR DELETE
  TO public
  USING (
    has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );

-- Also allow managers to manage sale orders linked to sessions
CREATE POLICY "Managers can create sale orders"
  ON public.sale_orders
  FOR INSERT
  TO public
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );

-- Allow managers to manage payments
CREATE POLICY "Managers can create payments"
  ON public.payments
  FOR INSERT
  TO public
  WITH CHECK (
    has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );
