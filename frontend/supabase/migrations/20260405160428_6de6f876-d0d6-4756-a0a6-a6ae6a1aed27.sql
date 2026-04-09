
-- ============================================
-- PAYROLL
-- ============================================

CREATE TABLE public.payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers can view payroll periods" ON public.payroll_periods FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage payroll periods" ON public.payroll_periods FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_payroll_periods_updated_at BEFORE UPDATE ON public.payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES auth.users(id) NOT NULL,
  period_id UUID REFERENCES public.payroll_periods(id) NOT NULL,
  basic_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees can view own payslips" ON public.payslips FOR SELECT
  USING (auth.uid() = employee_id);
CREATE POLICY "Managers can view all payslips" ON public.payslips FOR SELECT
  USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage payslips" ON public.payslips FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_payslips_updated_at BEFORE UPDATE ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.tax_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rate NUMERIC(5,2) NOT NULL,
  bracket_min NUMERIC(12,2) DEFAULT 0,
  bracket_max NUMERIC(12,2),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tax_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view tax configs" ON public.tax_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage tax configs" ON public.tax_configs FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- FINANCE CONFIGURATION
-- ============================================

CREATE TABLE public.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  parent_id UUID REFERENCES public.chart_of_accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view accounts" ON public.chart_of_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage accounts" ON public.chart_of_accounts FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_chart_of_accounts_updated_at BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rate NUMERIC(5,2) NOT NULL,
  type TEXT NOT NULL DEFAULT 'sales',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view tax rates" ON public.tax_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage tax rates" ON public.tax_rates FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view fiscal periods" ON public.fiscal_periods FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage fiscal periods" ON public.fiscal_periods FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_fiscal_periods_updated_at BEFORE UPDATE ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- NOTIFICATIONS
-- ============================================

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  module TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  is_read BOOLEAN NOT NULL DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "System can create notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);

CREATE INDEX idx_notifications_user ON public.notifications(user_id, is_read);
CREATE INDEX idx_payslips_employee ON public.payslips(employee_id);
CREATE INDEX idx_payslips_period ON public.payslips(period_id);
CREATE INDEX idx_chart_of_accounts_parent ON public.chart_of_accounts(parent_id);
