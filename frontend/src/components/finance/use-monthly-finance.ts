import { useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi, type MonthlyExpenseRow } from '@/api/finance-api';
import { payrollApi, type MonthlyPayrollRow } from '@/api/payroll-api';
import { salesApi, type MonthlyRevenueRow } from '@/api/sales-api';
import { getErrorMessage } from '@/api/decoders';

interface Params {
  token: string;
  scopeOutletId?: string;
}

export function useMonthlyFinance({ token, scopeOutletId }: Params) {
  const queryClient = useQueryClient();
  const outletKey = scopeOutletId || 'all';

  const revenueQuery = useQuery<MonthlyRevenueRow[]>({
    queryKey: ['sales', 'monthlyRevenue', outletKey],
    enabled: Boolean(token),
    queryFn: () => salesApi.monthlyRevenue(token, { outletId: scopeOutletId || undefined }),
  });

  const expenseQuery = useQuery<MonthlyExpenseRow[]>({
    queryKey: ['finance', 'monthlyExpenses', outletKey],
    enabled: Boolean(token),
    queryFn: () => financeApi.monthlyExpenses(token, { outletId: scopeOutletId || undefined }),
  });

  const payrollQuery = useQuery<MonthlyPayrollRow[]>({
    queryKey: ['payroll', 'monthly', outletKey],
    enabled: Boolean(token),
    queryFn: () => payrollApi.monthlyPayroll(token, { outletId: scopeOutletId || undefined }),
  });

  const loading = revenueQuery.isLoading || expenseQuery.isLoading || payrollQuery.isLoading;
  const error = [revenueQuery.error, expenseQuery.error, payrollQuery.error]
    .filter(Boolean)
    .map((e) => getErrorMessage(e, 'Unable to load monthly finance data'))
    .join(' · ');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['sales', 'monthlyRevenue', outletKey] });
    void queryClient.invalidateQueries({ queryKey: ['finance', 'monthlyExpenses', outletKey] });
    void queryClient.invalidateQueries({ queryKey: ['payroll', 'monthly', outletKey] });
  };

  return {
    revenueRows: revenueQuery.data ?? [],
    expenseRows: expenseQuery.data ?? [],
    payrollRows: payrollQuery.data ?? [],
    loading,
    error,
    refresh,
  };
}
