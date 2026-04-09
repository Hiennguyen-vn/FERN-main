
-- ============================================
-- 1. SHARED UTILITIES
-- ============================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============================================
-- 2. PROFILES & ROLES
-- ============================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  persona TEXT DEFAULT 'operator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Roles table (separate from profiles for security)
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'operator', 'viewer');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- 3. OUTLETS
-- ============================================

CREATE TABLE public.outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  region TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view outlets" ON public.outlets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage outlets" ON public.outlets FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_outlets_updated_at BEFORE UPDATE ON public.outlets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 4. POS SESSIONS & SALES
-- ============================================

CREATE TABLE public.pos_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id UUID REFERENCES public.outlets(id) NOT NULL,
  operator_id UUID REFERENCES auth.users(id) NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_float NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_cash NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators see own sessions" ON public.pos_sessions FOR SELECT USING (auth.uid() = operator_id);
CREATE POLICY "Managers see all sessions" ON public.pos_sessions FOR SELECT USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators can create sessions" ON public.pos_sessions FOR INSERT WITH CHECK (auth.uid() = operator_id);
CREATE POLICY "Operators can update own sessions" ON public.pos_sessions FOR UPDATE USING (auth.uid() = operator_id);

CREATE TRIGGER update_pos_sessions_updated_at BEFORE UPDATE ON public.pos_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.sale_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.pos_sessions(id) NOT NULL,
  order_number TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  table_number TEXT,
  order_type TEXT DEFAULT 'dine-in',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sale_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view orders from their sessions" ON public.sale_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.pos_sessions WHERE id = sale_orders.session_id AND operator_id = auth.uid())
  OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "Users can create orders" ON public.sale_orders FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update their orders" ON public.sale_orders FOR UPDATE USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER update_sale_orders_updated_at BEFORE UPDATE ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.sale_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.sale_orders(id) ON DELETE CASCADE NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sale_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view order items" ON public.sale_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create order items" ON public.sale_order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update order items" ON public.sale_order_items FOR UPDATE TO authenticated USING (true);

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.sale_orders(id) NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  amount NUMERIC(12,2) NOT NULL,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view payments" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================
-- 5. INVENTORY
-- ============================================

CREATE TABLE public.stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  reorder_level INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view stock items" ON public.stock_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can manage stock items" ON public.stock_items FOR ALL USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_stock_items_updated_at BEFORE UPDATE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.stock_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES public.stock_items(id) NOT NULL,
  outlet_id UUID REFERENCES public.outlets(id) NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_counted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, outlet_id)
);
ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view stock balances" ON public.stock_balances FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators can update stock balances" ON public.stock_balances FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Operators can insert stock balances" ON public.stock_balances FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES public.stock_items(id) NOT NULL,
  outlet_id UUID REFERENCES public.outlets(id) NOT NULL,
  adjustment_type TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  reason TEXT,
  adjusted_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view adjustments" ON public.stock_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators can create adjustments" ON public.stock_adjustments FOR INSERT WITH CHECK (auth.uid() = adjusted_by);

CREATE TABLE public.waste_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES public.stock_items(id) NOT NULL,
  outlet_id UUID REFERENCES public.outlets(id) NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  reason TEXT,
  recorded_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.waste_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view waste records" ON public.waste_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators can create waste records" ON public.waste_records FOR INSERT WITH CHECK (auth.uid() = recorded_by);

-- ============================================
-- 6. PROCUREMENT
-- ============================================

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can manage suppliers" ON public.suppliers FOR ALL USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id) NOT NULL,
  outlet_id UUID REFERENCES public.outlets(id),
  po_number TEXT NOT NULL UNIQUE,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view POs" ON public.purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create POs" ON public.purchase_orders FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Managers can update POs" ON public.purchase_orders FOR UPDATE USING (
  auth.uid() = created_by OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin')
);

CREATE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.po_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES public.purchase_orders(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES public.stock_items(id),
  description TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.po_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view PO items" ON public.po_line_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create PO items" ON public.po_line_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES public.purchase_orders(id) NOT NULL,
  received_by UUID REFERENCES auth.users(id) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view GRs" ON public.goods_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators can create GRs" ON public.goods_receipts FOR INSERT WITH CHECK (auth.uid() = received_by);

CREATE TABLE public.gr_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID REFERENCES public.goods_receipts(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES public.stock_items(id),
  quantity_received NUMERIC(12,2) NOT NULL,
  quantity_rejected NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.gr_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view GR items" ON public.gr_line_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators can create GR items" ON public.gr_line_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES public.purchase_orders(id),
  supplier_id UUID REFERENCES public.suppliers(id) NOT NULL,
  invoice_number TEXT NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  tax NUMERIC(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_review',
  due_date DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view invoices" ON public.supplier_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create invoices" ON public.supplier_invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Managers can update invoices" ON public.supplier_invoices FOR UPDATE USING (
  public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin')
);

CREATE TRIGGER update_supplier_invoices_updated_at BEFORE UPDATE ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES public.supplier_invoices(id) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  method TEXT NOT NULL DEFAULT 'bank_transfer',
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view payments" ON public.supplier_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create supplier payments" ON public.supplier_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Managers can update supplier payments" ON public.supplier_payments FOR UPDATE USING (
  public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin')
);

CREATE TRIGGER update_supplier_payments_updated_at BEFORE UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 7. INDEXES
-- ============================================

CREATE INDEX idx_pos_sessions_outlet ON public.pos_sessions(outlet_id);
CREATE INDEX idx_pos_sessions_operator ON public.pos_sessions(operator_id);
CREATE INDEX idx_sale_orders_session ON public.sale_orders(session_id);
CREATE INDEX idx_sale_order_items_order ON public.sale_order_items(order_id);
CREATE INDEX idx_payments_order ON public.payments(order_id);
CREATE INDEX idx_stock_balances_item_outlet ON public.stock_balances(item_id, outlet_id);
CREATE INDEX idx_stock_adjustments_item ON public.stock_adjustments(item_id);
CREATE INDEX idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX idx_po_line_items_po ON public.po_line_items(po_id);
CREATE INDEX idx_goods_receipts_po ON public.goods_receipts(po_id);
CREATE INDEX idx_supplier_invoices_po ON public.supplier_invoices(po_id);
CREATE INDEX idx_supplier_payments_invoice ON public.supplier_payments(invoice_id);
