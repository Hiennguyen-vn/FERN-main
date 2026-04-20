import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  financeApi,
  payrollApi,
  type ExpenseView,
  type FinanceExpensesQuery,
  type PayrollPeriodView,
  type PayrollPeriodsQuery,
  type PayrollRunView,
  type PayrollRunsQuery,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';
import { getFinanceOutletDisplay } from '@/components/finance/finance-display';
import type { FinanceTab } from '@/components/finance/finance-workspace-config';
import {
  availablePeriodsFromMonthly,
  buildMonthlyPl,
  buildRevenueSnapshot,
  describeFinanceScope,
  findPeriodComparison,
  formatPeriodLabel,
  getFinanceVisibleOutlets,
  getFinanceVarianceStatus,
  getPeriodKey,
  toNumber,
} from '@/components/finance/finance-phase2-utils';
import { formatMoney } from '@/components/finance/finance-utils';
import { useFinanceSalesOrders } from '@/components/finance/use-finance-sales-orders';
import { useMonthlyFinance } from '@/components/finance/use-monthly-finance';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
  onNavigate: (tab: FinanceTab) => void;
}

interface OverviewKpis {
  netSales: number;
  totalPayroll: number;
  totalExpenses: number;
  otherExpenses: number;
  manualExpenses: number;
  payrollExpenses: number;
  invoiceExpenses: number;
  laborPct: number | null;
  otherOpExPct: number | null;
  varianceFlags: number;
  currency: string;
}

interface PeriodCloseStatus {
  total: number;
  approved: number;
  pending: number;
}

interface OutletPerformanceRow {
  outletId: string;
  outletCode: string;
  outletName: string;
  netSales: number;
  payroll: number;
  laborPct: number | null;
  otherExpenses: number;
  otherOpExPct: number | null;
  status: 'clear' | 'watch' | 'risk' | 'no-sales';
}

function sourceLabel(sourceType?: string | null, subtype?: string | null): {
  label: string;
  color: string;
} {
  const raw = String(subtype || sourceType || '').toLowerCase();
  if (raw === 'payroll') return { label: 'Payroll', color: 'bg-purple-100 text-purple-700 border-purple-200' };
  if (raw.includes('invoice') || raw === 'inventory_purchase') return { label: 'Invoice', color: 'bg-orange-100 text-orange-700 border-orange-200' };
  if (raw === 'operating_expense' || raw === 'operating' || raw === 'other' || raw === 'other_expense') return { label: 'Manual', color: 'bg-blue-100 text-blue-700 border-blue-200' };
  return { label: 'System', color: 'bg-muted text-muted-foreground border-border' };
}

/** Show ratio as "X.X% of sales" when sensible, or a warning when extreme */
function safeRatioLabel(pct: number | null, suffix: string): string {
  if (pct == null) return 'No sales data';
  if (pct > 200) return 'Exceeds sales — check data';
  if (pct > 100) return `${pct.toFixed(1)}% ${suffix} — over 100%`;
  return `${pct.toFixed(1)}% ${suffix}`;
}

function ratioTone(pct: number | null, warnAt: number, dangerAt: number): 'default' | 'warning' | 'danger' {
  if (pct == null) return 'default';
  if (pct > 100) return 'danger';
  if (pct > dangerAt) return 'danger';
  if (pct > warnAt) return 'warning';
  return 'default';
}

function formatDelta(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return 'Latest period';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

export function FinanceOverviewWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
  onNavigate,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('');
  const {
    revenueRows: monthlyRevenueRows,
    expenseRows: monthlyExpenseRows,
    payrollRows: monthlyPayrollRows,
    loading: monthlyLoading,
    error: monthlyError,
    refresh: refreshMonthly,
  } = useMonthlyFinance({ token, scopeOutletId });
  const {
    orders,
    visibleOutlets,
    loading: salesLoading,
    error: salesError,
    refresh: refreshSales,
  } = useFinanceSalesOrders({
    token,
    scopeRegionId,
    scopeOutletId,
    outlets,
  });

  const scopedVisibleOutlets = useMemo(
    () => (
      visibleOutlets.length > 0
        ? visibleOutlets
        : getFinanceVisibleOutlets(outlets, scopeRegionId, scopeOutletId)
    ),
    [outlets, scopeOutletId, scopeRegionId, visibleOutlets],
  );
  const outletsById = useMemo(
    () => new Map(outlets.map((outlet) => [outlet.id, outlet])),
    [outlets],
  );
  const scopeLabel = useMemo(
    () =>
      describeFinanceScope({
        scopeRegionId,
        scopeOutletId,
        regions,
        outlets,
      }),
    [outlets, regions, scopeOutletId, scopeRegionId],
  );
  const periodById = useMemo(
    () => new Map(periods.map((period) => [period.id, period])),
    [periods],
  );

  const resolveRunPeriodKey = useCallback((run: PayrollRunView) => {
    const linkedPeriod = periodById.get(String(run.payrollPeriodId || ''));
    return getPeriodKey(linkedPeriod?.startDate || linkedPeriod?.payDate || run.createdAt);
  }, [periodById]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [expItems, periodItems, runItems] = await Promise.all([
        collectPagedItems<ExpenseView, FinanceExpensesQuery>(
          (q) => financeApi.expenses(token, q),
          {
            outletId: scopeOutletId || undefined,
            sortBy: 'businessDate',
            sortDir: 'desc',
          },
          500,
          200,
        ).catch(() => [] as ExpenseView[]),
        collectPagedItems<PayrollPeriodView, PayrollPeriodsQuery>(
          (query) => payrollApi.periods(token, query),
          {
            regionId: scopeRegionId || undefined,
            sortBy: 'startDate',
            sortDir: 'desc',
          },
          100,
        ).catch(() => [] as PayrollPeriodView[]),
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (query) => payrollApi.runs(token, query),
          {
            outletId: scopeOutletId || undefined,
            sortBy: 'createdAt',
            sortDir: 'desc',
          },
          500,
          200,
        ).catch(() => [] as PayrollRunView[]),
      ]);

      setExpenses(expItems);
      setPeriods(periodItems);
      setRuns(runItems);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load finance overview'));
    } finally {
      setLoading(false);
    }
  }, [scopeOutletId, scopeRegionId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectablePeriods = useMemo(() => {
    const keys = new Set<string>(
      availablePeriodsFromMonthly(monthlyRevenueRows, monthlyExpenseRows, monthlyPayrollRows),
    );

    orders.forEach((order) => {
      const key = getPeriodKey(order.createdAt);
      if (key) keys.add(key);
    });
    expenses.forEach((expense) => {
      const key = getPeriodKey(expense.businessDate || expense.createdAt);
      if (key) keys.add(key);
    });
    periods.forEach((period) => {
      const key = getPeriodKey(period.startDate || period.payDate);
      if (key) keys.add(key);
    });
    runs.forEach((run) => {
      const key = resolveRunPeriodKey(run);
      if (key) keys.add(key);
    });

    return Array.from(keys)
      .sort((left, right) => right.localeCompare(left))
      .map((key) => ({
        key,
        label: formatPeriodLabel(key),
      }));
  }, [expenses, orders, periods, resolveRunPeriodKey, runs, monthlyRevenueRows, monthlyExpenseRows, monthlyPayrollRows]);

  useEffect(() => {
    setSelectedPeriodKey((current) => {
      if (current && selectablePeriods.some((option) => option.key === current)) {
        return current;
      }
      return selectablePeriods[0]?.key || '';
    });
  }, [selectablePeriods]);

  const activePeriodKey = selectedPeriodKey || selectablePeriods[0]?.key || '';
  const comparisonPeriod = useMemo(
    () => findPeriodComparison(selectablePeriods, activePeriodKey),
    [activePeriodKey, selectablePeriods],
  );

  const revenueSnapshot = useMemo(
    () =>
      buildRevenueSnapshot({
        orders,
        visibleOutlets: scopedVisibleOutlets,
        periodKey: activePeriodKey,
        channelFilter: 'all',
      }),
    [activePeriodKey, orders, scopedVisibleOutlets],
  );
  const comparisonSnapshot = useMemo(
    () =>
      comparisonPeriod
        ? buildRevenueSnapshot({
            orders,
            visibleOutlets: scopedVisibleOutlets,
            periodKey: comparisonPeriod.key,
            channelFilter: 'all',
          })
        : null,
    [comparisonPeriod, orders, scopedVisibleOutlets],
  );

  const currentExpenses = useMemo(
    () => expenses.filter((expense) => getPeriodKey(expense.businessDate || expense.createdAt) === activePeriodKey),
    [activePeriodKey, expenses],
  );
  const currentPeriodRuns = useMemo(
    () => runs.filter((run) => resolveRunPeriodKey(run) === activePeriodKey),
    [activePeriodKey, resolveRunPeriodKey, runs],
  );
  const approvedRuns = useMemo(
    () => currentPeriodRuns.filter((run) => {
      const st = String(run.status || '').toLowerCase();
      return st === 'approved' || st === 'paid';
    }),
    [currentPeriodRuns],
  );

  const monthlyPl = useMemo(() => {
    if (!activePeriodKey) return null;
    return buildMonthlyPl({
      revenueRows: monthlyRevenueRows,
      expenseRows: monthlyExpenseRows,
      payrollRows: monthlyPayrollRows,
      periodKey: activePeriodKey,
      visibleOutlets: scopedVisibleOutlets,
    });
  }, [activePeriodKey, monthlyRevenueRows, monthlyExpenseRows, monthlyPayrollRows, scopedVisibleOutlets]);

  const overviewKpis = useMemo((): OverviewKpis => {
    const pl = monthlyPl;
    const currency = pl?.currency || revenueSnapshot.currency || 'USD';
    if (!pl) {
      return {
        netSales: 0,
        totalPayroll: 0,
        totalExpenses: 0,
        otherExpenses: 0,
        manualExpenses: 0,
        payrollExpenses: 0,
        invoiceExpenses: 0,
        laborPct: null,
        otherOpExPct: null,
        varianceFlags: 0,
        currency,
      };
    }
    const otherExpenses = pl.totalOpEx;
    const totalExpenses = otherExpenses + pl.payrollCost;
    const varianceFlags = pl.outletRows.reduce((count, row) => {
      const status = getFinanceVarianceStatus(row.laborPct, row.opExPct, row.netSales);
      return status === 'watch' || status === 'risk' ? count + 1 : count;
    }, 0);
    return {
      netSales: pl.netSales,
      totalPayroll: pl.payrollCost,
      totalExpenses,
      otherExpenses,
      manualExpenses: pl.manualExpenses,
      payrollExpenses: pl.payrollCost,
      invoiceExpenses: pl.invoiceExpenses + pl.inventoryExpenses,
      laborPct: pl.laborPct,
      otherOpExPct: pl.opExPct,
      varianceFlags,
      currency,
    };
  }, [monthlyPl, revenueSnapshot.currency]);

  const closeStatus = useMemo((): PeriodCloseStatus => {
    const approved = currentPeriodRuns.filter((run) => String(run.status || '').toLowerCase() === 'approved').length;
    return {
      total: currentPeriodRuns.length,
      approved,
      pending: currentPeriodRuns.length - approved,
    };
  }, [currentPeriodRuns]);

  const currentPayrollPeriod = useMemo(
    () => periods.find((period) => getPeriodKey(period.startDate || period.payDate) === activePeriodKey) ?? periods[0] ?? null,
    [activePeriodKey, periods],
  );

  const sourceMix = useMemo(() => {
    const total = overviewKpis.totalExpenses;
    if (total === 0) return { manual: 0, payroll: 0, invoice: 0 };
    return {
      manual: Math.round((overviewKpis.manualExpenses / total) * 100),
      payroll: Math.round((overviewKpis.payrollExpenses / total) * 100),
      invoice: Math.round((overviewKpis.invoiceExpenses / total) * 100),
    };
  }, [overviewKpis]);

  const outletPerformanceRows = useMemo((): OutletPerformanceRow[] => {
    if (!monthlyPl) return [];
    return monthlyPl.outletRows
      .map((row) => ({
        outletId: row.outletId,
        outletCode: row.outletCode,
        outletName: row.outletName,
        netSales: row.netSales,
        payroll: row.payroll,
        laborPct: row.laborPct,
        otherExpenses: row.opEx,
        otherOpExPct: row.opExPct,
        status: getFinanceVarianceStatus(row.laborPct, row.opExPct, row.netSales),
      }))
      .sort((left, right) => right.netSales - left.netSales);
  }, [monthlyPl]);

  const recentExpenses = useMemo(
    () => currentExpenses.slice(0, 6),
    [currentExpenses],
  );

  const revenueDeltaPct = comparisonSnapshot && comparisonSnapshot.netSales > 0
    ? ((revenueSnapshot.netSales - comparisonSnapshot.netSales) / comparisonSnapshot.netSales) * 100
    : null;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Compact header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{scopeLabel}</h2>
          <p className="text-xs text-muted-foreground">
            {formatPeriodLabel(activePeriodKey)} · {revenueSnapshot.completedOrderCount} orders
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
            value={activePeriodKey}
            onChange={(event) => setSelectedPeriodKey(event.target.value)}
          >
            {selectablePeriods.length === 0 ? (
              <option value="">No periods</option>
            ) : (
              selectablePeriods.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))
            )}
          </select>
          <button
            onClick={() => { void load(); void refreshSales(); void refreshMonthly(); }}
            disabled={loading || salesLoading || monthlyLoading}
            className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', (loading || salesLoading || monthlyLoading) && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {(error || salesError || monthlyError) ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          {[error, salesError, monthlyError].filter(Boolean).join(' · ')}
        </div>
      ) : null}

      {/* KPI cards — 4 primary metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Net Sales"
          value={formatMoney(overviewKpis.netSales, overviewKpis.currency)}
          sub={`${revenueSnapshot.completedOrderCount} orders`}
          delta={comparisonPeriod ? formatDelta(revenueDeltaPct) : undefined}
          deltaPositive={revenueDeltaPct != null ? revenueDeltaPct >= 0 : undefined}
        />
        <KpiCard
          label="Labor Cost"
          value={formatMoney(overviewKpis.totalPayroll, overviewKpis.currency)}
          sub={safeRatioLabel(overviewKpis.laborPct, 'of sales')}
          tone={ratioTone(overviewKpis.laborPct, 35, 40)}
        />
        <KpiCard
          label="Operating Expenses"
          value={formatMoney(overviewKpis.otherExpenses, overviewKpis.currency)}
          sub={safeRatioLabel(overviewKpis.otherOpExPct, 'of sales')}
          tone={ratioTone(overviewKpis.otherOpExPct, 25, 30)}
        />
        <KpiCard
          label="Variance Flags"
          value={String(overviewKpis.varianceFlags)}
          sub={overviewKpis.varianceFlags === 0 ? 'All outlets within target' : `${overviewKpis.varianceFlags} outlet(s) over threshold`}
          tone={overviewKpis.varianceFlags > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Main content grid */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {/* Daily trend chart */}
          <section className="surface-elevated overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Daily revenue</h3>
              <button onClick={() => onNavigate('revenue')} className="text-xs text-primary hover:underline">Details →</button>
            </div>
            <div className="h-[220px] px-3 py-3">
              {revenueSnapshot.trend.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data for this period.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueSnapshot.trend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis axisLine={false} tickLine={false} width={60} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => formatMoney(Number(v), overviewKpis.currency)} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 }} formatter={(v: number) => formatMoney(Number(v), overviewKpis.currency)} />
                    <Bar dataKey="netSales" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* Outlet table */}
          <section className="surface-elevated overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Outlet performance</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Outlet', 'Net Sales', 'Labor %', 'OpEx %', 'Status'].map((h) => (
                      <th key={h} className={cn('px-4 py-2 text-[11px] font-medium', ['Net Sales', 'Labor %', 'OpEx %'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {outletPerformanceRows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">No outlet data.</td></tr>
                  ) : (
                    outletPerformanceRows.map((row) => (
                      <tr key={row.outletId} className="border-b last:border-0 hover:bg-accent/20">
                        <td className="px-4 py-2.5">
                          <span className="text-sm font-medium">{row.outletCode}</span>
                          <span className="ml-1.5 text-xs text-muted-foreground">{row.outletName}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm">{formatMoney(row.netSales, overviewKpis.currency)}</td>
                        <td className={cn('px-4 py-2.5 text-right text-sm', row.laborPct != null && row.laborPct > 100 && 'text-red-600')}>
                          {row.laborPct == null ? '—' : row.laborPct > 200 ? '>200%' : `${row.laborPct.toFixed(1)}%`}
                        </td>
                        <td className={cn('px-4 py-2.5 text-right text-sm', row.otherOpExPct != null && row.otherOpExPct > 100 && 'text-red-600')}>
                          {row.otherOpExPct == null ? '—' : row.otherOpExPct > 200 ? '>200%' : `${row.otherOpExPct.toFixed(1)}%`}
                        </td>
                        <td className="px-4 py-2.5"><OutletStatusBadge status={row.status} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Recent expenses */}
          <section className="surface-elevated overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Recent expenses</h3>
              <button onClick={() => onNavigate('expenses')} className="text-xs text-primary hover:underline">View all →</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Date', 'Outlet', 'Description', 'Source', 'Amount'].map((h) => (
                      <th key={h} className={cn('px-4 py-2 text-[11px] font-medium', h === 'Amount' ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentExpenses.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">No expenses this period.</td></tr>
                  ) : (
                    recentExpenses.map((expense) => {
                      const outletDisplay = getFinanceOutletDisplay(outletsById, expense.outletId);
                      const source = sourceLabel(expense.sourceType, expense.subtype);
                      return (
                        <tr key={String(expense.id)} className="border-b last:border-0">
                          <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{String(expense.businessDate || '—')}</td>
                          <td className="px-4 py-2 text-xs font-medium">{outletDisplay.primary}</td>
                          <td className="px-4 py-2 text-xs">{String(expense.description || '—')}</td>
                          <td className="px-4 py-2">
                            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', source.color)}>{source.label}</span>
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-mono">{formatMoney(expense.amount, String(expense.currencyCode || overviewKpis.currency))}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          <section className="surface-elevated px-4 py-4">
            <h3 className="mb-3 text-sm font-semibold">Expense sources</h3>
            {overviewKpis.totalExpenses === 0 ? (
              <p className="text-xs text-muted-foreground">No expense data.</p>
            ) : (
              <div className="space-y-2">
                <SourceBar label="Manual" pct={sourceMix.manual} color="bg-blue-500" />
                <SourceBar label="Invoice" pct={sourceMix.invoice} color="bg-orange-500" />
                <SourceBar label="Payroll" pct={sourceMix.payroll} color="bg-purple-500" />
              </div>
            )}
            <button onClick={() => onNavigate('expenses')} className="mt-3 text-xs text-primary hover:underline">View ledger →</button>
          </section>

          <section className="surface-elevated px-4 py-4">
            <h3 className="mb-1 text-sm font-semibold">Period close</h3>
            <p className="text-xs text-muted-foreground">
              {currentPayrollPeriod ? String(currentPayrollPeriod.name || formatPeriodLabel(activePeriodKey)) : formatPeriodLabel(activePeriodKey)}
            </p>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" />{closeStatus.approved} approved</span>
              <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-amber-500" />{closeStatus.pending} pending</span>
            </div>
            {closeStatus.total > 0 && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-1.5 rounded-full bg-green-500 transition-all" style={{ width: `${Math.round((closeStatus.approved / closeStatus.total) * 100)}%` }} />
              </div>
            )}
            <button onClick={() => onNavigate('close')} className="mt-3 text-xs text-primary hover:underline">View checklist →</button>
          </section>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  delta,
  deltaPositive,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  deltaPositive?: boolean;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <div className={cn(
      'surface-elevated rounded-lg px-4 py-3',
      tone === 'danger' && 'ring-1 ring-red-200',
      tone === 'warning' && 'ring-1 ring-amber-200',
    )}>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-lg font-semibold tabular-nums',
        tone === 'danger' && 'text-red-700',
        tone === 'warning' && 'text-amber-700',
      )}>{value}</p>
      {delta ? (
        <span className={cn(
          'mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium',
          deltaPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
        )}>{delta}</span>
      ) : sub ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function OutletStatusBadge({ status }: { status: OutletPerformanceRow['status'] }) {
  if (status === 'risk') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" /> Risk
      </span>
    );
  }
  if (status === 'watch') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        <Clock className="h-3 w-3" /> Watch
      </span>
    );
  }
  if (status === 'no-sales') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        No Sales
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
      <CheckCircle2 className="h-3 w-3" /> Good
    </span>
  );
}

function SourceBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-2 rounded-full transition-all', color)} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs font-mono font-medium">{pct}%</span>
    </div>
  );
}
