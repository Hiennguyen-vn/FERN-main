import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  RefreshCw,
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
  type PayrollPeriodView,
  type PayrollPeriodsQuery,
  type PayrollRunView,
  type PayrollRunsQuery,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';
import {
  buildFinancePeriodOptions,
  buildRevenueSnapshot,
  describeFinanceScope,
  findPeriodComparison,
  formatPeriodLabel,
  getPeriodKey,
  toNumber,
} from '@/components/finance/finance-phase2-utils';
import { formatMoney } from '@/components/finance/finance-utils';
import { useFinanceSalesOrders } from '@/components/finance/use-finance-sales-orders';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}

interface OutletCostRow {
  outletId: string;
  outletCode: string;
  outletName: string;
  netSales: number;
  payroll: number;
  laborPct: number | null;
  otherExpenses: number;
  totalOpCost: number;
  opCostPct: number | null;
  currency: string;
}

export function FinancePrimeCostWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('');
  const [thresholdPct, setThresholdPct] = useState(65);
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

  const scopedRegionId = useMemo(() => {
    if (scopeRegionId) return scopeRegionId;
    if (!scopeOutletId) return '';
    return outlets.find((outlet) => outlet.id === scopeOutletId)?.regionId || '';
  }, [outlets, scopeOutletId, scopeRegionId]);

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

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [expPage, runItems, periodItems] = await Promise.all([
        financeApi.expenses(token, {
          outletId: scopeOutletId || undefined,
          limit: 500,
          sortBy: 'businessDate',
          sortDir: 'desc',
        }),
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (query) => payrollApi.runs(token, query),
          {
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
          500,
        ),
        collectPagedItems<PayrollPeriodView, PayrollPeriodsQuery>(
          (query) => payrollApi.periods(token, query),
          {
            regionId: scopedRegionId || undefined,
            sortBy: 'startDate',
            sortDir: 'desc',
          },
          100,
        ),
      ]);
      setExpenses(expPage.items || []);
      setRuns(runItems);
      setPeriods(periodItems);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load cost data'));
    } finally {
      setLoading(false);
    }
  }, [scopedRegionId, scopeOutletId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodOptions = useMemo(
    () => buildFinancePeriodOptions(orders),
    [orders],
  );

  useEffect(() => {
    setSelectedPeriodKey((current) => {
      if (current && periodOptions.some((option) => option.key === current)) {
        return current;
      }
      return periodOptions[0]?.key || '';
    });
  }, [periodOptions]);

  const activePeriodKey = selectedPeriodKey || periodOptions[0]?.key || '';
  const priorPeriod = useMemo(
    () => findPeriodComparison(periodOptions, activePeriodKey),
    [activePeriodKey, periodOptions],
  );
  const currentRevenue = useMemo(
    () =>
      buildRevenueSnapshot({
        orders,
        visibleOutlets,
        periodKey: activePeriodKey,
        channelFilter: 'all',
      }),
    [activePeriodKey, orders, visibleOutlets],
  );
  const priorRevenue = useMemo(
    () =>
      priorPeriod
        ? buildRevenueSnapshot({
            orders,
            visibleOutlets,
            periodKey: priorPeriod.key,
            channelFilter: 'all',
          })
        : null,
    [orders, priorPeriod, visibleOutlets],
  );
  const revenueByOutlet = useMemo(
    () => new Map(currentRevenue.outletRows.map((row) => [row.outletId, row.netSales])),
    [currentRevenue.outletRows],
  );
  const priorRevenueByOutlet = useMemo(
    () => new Map((priorRevenue?.outletRows || []).map((row) => [row.outletId, row.netSales])),
    [priorRevenue?.outletRows],
  );
  const periodById = useMemo(
    () => new Map(periods.map((period) => [period.id, period])),
    [periods],
  );

  const resolveRunPeriodKey = useCallback((run: PayrollRunView) => {
    const linkedPeriod = periodById.get(String(run.payrollPeriodId || ''));
    return getPeriodKey(linkedPeriod?.startDate || linkedPeriod?.payDate || run.createdAt);
  }, [periodById]);

  const outletRows = useMemo((): OutletCostRow[] => {
    const relevantOutlets = visibleOutlets.length > 0
      ? visibleOutlets
      : scopeOutletId
        ? outlets.filter((outlet) => outlet.id === scopeOutletId)
        : outlets.filter((outlet) => !scopedRegionId || outlet.regionId === scopedRegionId);

    return relevantOutlets.map((outlet): OutletCostRow => {
      const outletRuns = runs.filter(
        (run) =>
          String(run.outletId) === outlet.id
          && String(run.status || '').toLowerCase() === 'approved'
          && resolveRunPeriodKey(run) === activePeriodKey,
      );
      const outletExpenses = expenses.filter(
        (expense) =>
          String(expense.outletId) === outlet.id
          && getPeriodKey(expense.businessDate || expense.createdAt) === activePeriodKey,
      );

      const payroll = outletRuns.reduce((sum, run) => sum + toNumber(run.netSalary), 0);
      const otherExpenses = outletExpenses
        .filter((expense) => String(expense.subtype || expense.sourceType || '').toLowerCase() !== 'payroll')
        .reduce((sum, expense) => sum + toNumber(expense.amount), 0);
      const netSales = revenueByOutlet.get(outlet.id) || 0;
      const totalOpCost = payroll + otherExpenses;
      const currency = outletExpenses[0]?.currencyCode
        ?? outletRuns[0]?.currencyCode
        ?? currentRevenue.currency
        ?? 'USD';

      return {
        outletId: outlet.id,
        outletCode: outlet.code || outlet.id,
        outletName: outlet.name || outlet.id,
        netSales,
        payroll,
        laborPct: netSales > 0 ? (payroll / netSales) * 100 : null,
        otherExpenses,
        totalOpCost,
        opCostPct: netSales > 0 ? (totalOpCost / netSales) * 100 : null,
        currency: String(currency),
      };
    }).sort((left, right) => right.totalOpCost - left.totalOpCost);
  }, [activePeriodKey, currentRevenue.currency, expenses, outlets, resolveRunPeriodKey, revenueByOutlet, runs, scopeOutletId, scopedRegionId, visibleOutlets]);

  const totals = useMemo(() => {
    return outletRows.reduce(
      (acc, row) => ({
        netSales: acc.netSales + row.netSales,
        payroll: acc.payroll + row.payroll,
        otherExpenses: acc.otherExpenses + row.otherExpenses,
        totalOpCost: acc.totalOpCost + row.totalOpCost,
      }),
      { netSales: 0, payroll: 0, otherExpenses: 0, totalOpCost: 0 },
    );
  }, [outletRows]);

  const currency = outletRows[0]?.currency ?? currentRevenue.currency ?? 'USD';
  const laborPct = totals.netSales > 0 ? (totals.payroll / totals.netSales) * 100 : null;
  const opCostPct = totals.netSales > 0 ? (totals.totalOpCost / totals.netSales) * 100 : null;

  const comparisonRows = useMemo(() => {
    return outletRows.map((row) => {
      const priorNetSalesValue = priorRevenueByOutlet.get(row.outletId) || 0;
      const priorPayroll = runs
        .filter(
          (run) =>
            String(run.outletId) === row.outletId
            && String(run.status || '').toLowerCase() === 'approved'
            && priorPeriod
            && resolveRunPeriodKey(run) === priorPeriod.key,
        )
        .reduce((sum, run) => sum + toNumber(run.netSalary), 0);
      const priorExpensesValue = expenses
        .filter(
          (expense) =>
            String(expense.outletId) === row.outletId
            && priorPeriod
            && getPeriodKey(expense.businessDate || expense.createdAt) === priorPeriod.key
            && String(expense.subtype || expense.sourceType || '').toLowerCase() !== 'payroll',
        )
        .reduce((sum, expense) => sum + toNumber(expense.amount), 0);
      const priorOpCost = priorPayroll + priorExpensesValue;
      const priorPct = priorNetSalesValue > 0 ? (priorOpCost / priorNetSalesValue) * 100 : null;

      return {
        outletId: row.outletId,
        outlet: row.outletCode,
        currentPct: row.opCostPct ?? 0,
        priorPct: priorPct ?? 0,
      };
    });
  }, [expenses, outletRows, priorPeriod, priorRevenueByOutlet, resolveRunPeriodKey, runs]);

  const alerts = useMemo(() => {
    return outletRows
      .flatMap((row) => {
        const items: Array<{ key: string; label: string; tone: 'critical' | 'warning'; message: string }> = [];

        if (row.laborPct != null && row.laborPct > 40) {
          items.push({
            key: `${row.outletId}-labor-critical`,
            label: row.outletCode,
            tone: 'critical',
            message: row.laborPct > 200 ? `Labor far exceeds sales (>200%). Check that payroll and sales periods match.` : `Labor is ${row.laborPct.toFixed(1)}% of sales — above the 40% threshold.`,
          });
        } else if (row.laborPct != null && row.laborPct > 35) {
          items.push({
            key: `${row.outletId}-labor-warning`,
            label: row.outletCode,
            tone: 'warning',
            message: `Labor is ${row.laborPct.toFixed(1)}% of sales — approaching the 40% threshold.`,
          });
        }

        if (row.opCostPct != null && row.opCostPct > thresholdPct) {
          items.push({
            key: `${row.outletId}-op-cost`,
            label: row.outletCode,
            tone: row.opCostPct > thresholdPct + 8 ? 'critical' : 'warning',
            message: `Operating cost is ${row.opCostPct.toFixed(1)}% of sales — above the ${thresholdPct}% target.`,
          });
        }

        return items;
      })
      .slice(0, 5);
  }, [outletRows, thresholdPct]);

  return (
    <div className="animate-fade-in space-y-5">
      {/* Compact header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{scopeLabel}</h2>
          <p className="text-xs text-muted-foreground">{formatPeriodLabel(activePeriodKey)} · Cost analysis by outlet</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-8 rounded-md border border-input bg-background px-2.5 text-xs" value={activePeriodKey} onChange={(event) => setSelectedPeriodKey(event.target.value)}>
            {periodOptions.length === 0 ? (<option value="">No periods</option>) : (periodOptions.map((option) => (<option key={option.key} value={option.key}>{option.label}</option>)))}
          </select>
          <select className="h-8 rounded-md border border-input bg-background px-2.5 text-xs" value={String(thresholdPct)} onChange={(event) => setThresholdPct(Number(event.target.value))}>
            {[55, 60, 65, 70].map((value) => (<option key={value} value={value}>Target: {value}%</option>))}
          </select>
          <button onClick={() => { void load(); void refreshSales(); }} disabled={loading || salesLoading} className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-accent disabled:opacity-60">
            <RefreshCw className={cn('h-3.5 w-3.5', (loading || salesLoading) && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      <section className="surface-elevated overflow-hidden">

        <div className="grid gap-0 md:grid-cols-6">
          {[
            { label: 'Net Sales', value: formatMoney(totals.netSales, currency), sub: formatPeriodLabel(activePeriodKey) },
            { label: 'Labor Total', value: formatMoney(totals.payroll, currency), sub: totals.payroll === 0 ? 'No approved payroll in scope' : laborPct == null ? 'No sales data' : laborPct > 200 ? 'Exceeds sales — check data' : `${laborPct.toFixed(1)}% of sales` },
            { label: 'Other OpEx', value: formatMoney(totals.otherExpenses, currency), sub: 'Non-payroll expenses' },
            { label: 'Operating Cost %', value: opCostPct == null ? '—' : opCostPct > 200 ? '>200%' : `${opCostPct.toFixed(1)}%`, sub: `Target: ${thresholdPct}%` },
            { label: 'COGS', value: '—', sub: 'Inventory not connected' },
            { label: 'Prime Cost %', value: '—', sub: 'Requires COGS data' },
          ].map((item, index) => (
            <div
              key={item.label}
              className={cn(
                'px-6 py-4 transition-colors',
                index > 0 && 'border-t md:border-l md:border-t-0',
              )}
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-xl font-semibold">{item.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.sub}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Labor % and operating cost % are calculated from live revenue. Prime Cost % and Gross Margin will appear automatically once inventory (COGS) is connected in the Procurement module.
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {salesError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {salesError}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <section className="surface-elevated overflow-hidden">
          <div className="border-b px-5 py-4">
            <h3 className="text-sm font-semibold">Operating cost % current vs prior</h3>
            <p className="text-xs text-muted-foreground">
              Cost ratios are based on net sales. Prior period comparison uses the previous month.
            </p>
          </div>
          <div className="h-[320px] px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="outlet"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid hsl(var(--border))',
                    background: 'hsl(var(--card))',
                    fontSize: 12,
                  }}
                  formatter={(value: number) => `${Number(value).toFixed(1)}%`}
                />
                <Bar dataKey="currentPct" name={formatPeriodLabel(activePeriodKey)} fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                {priorPeriod ? (
                  <Bar dataKey="priorPct" name={priorPeriod.label} fill="hsl(var(--primary) / 0.38)" radius={[8, 8, 0, 0]} />
                ) : null}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="surface-elevated overflow-hidden">
          <div className="border-b px-5 py-4">
            <h3 className="text-sm font-semibold">Variance signals</h3>
            <p className="text-xs text-muted-foreground">
              Cost alerts for labor and operating expenses in the selected period.
            </p>
          </div>
          <div className="space-y-3 px-5 py-4">
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cost alerts for the selected period. Labor and operating costs are within target thresholds.
              </p>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.key}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm transition-colors',
                    alert.tone === 'critical'
                      ? 'border-rose-200 bg-rose-50/70 text-rose-900'
                      : 'border-amber-200 bg-amber-50/70 text-amber-900',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        alert.tone === 'critical' ? 'text-rose-600' : 'text-amber-600',
                      )}
                    />
                    <div>
                      <p className="font-medium">{alert.label}</p>
                      <p className="mt-1 text-xs">{alert.message}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="surface-elevated overflow-hidden">
        <div className="border-b px-5 py-4">
          <h3 className="text-sm font-semibold">Outlet cost breakdown</h3>
          <p className="text-xs text-muted-foreground">
            Labor % and operating cost % are calculated from live revenue. Prime Cost % requires COGS data from the Procurement module.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Outlet', 'Net Sales', 'Payroll', 'Labor %', 'Other Expenses', 'Total Op Cost', 'Op Cost %', 'Prime Cost %'].map((header) => (
                  <th
                    key={header}
                    className={cn(
                      'px-4 py-2.5 text-[11px] font-medium',
                      ['Net Sales', 'Payroll', 'Labor %', 'Other Expenses', 'Total Op Cost', 'Op Cost %', 'Prime Cost %'].includes(header)
                        ? 'text-right'
                        : 'text-left',
                    )}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(loading || salesLoading) && outletRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</td>
                </tr>
              ) : outletRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No outlet data in current scope.
                  </td>
                </tr>
              ) : (
                outletRows.map((row) => (
                  <tr key={row.outletId} className="border-b last:border-0 transition-colors hover:bg-accent/20">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{row.outletCode}</span>
                        <span className="text-[11px] text-muted-foreground">{row.outletName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-medium">
                      {row.netSales > 0 ? formatMoney(row.netSales, row.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {formatMoney(row.payroll, row.currency)}
                    </td>
                    <td className={cn('px-4 py-3 text-right text-sm', row.laborPct != null && row.laborPct > 100 && 'text-red-600')}>
                      {row.laborPct == null ? '—' : row.laborPct > 200 ? '>200%' : `${row.laborPct.toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {formatMoney(row.otherExpenses, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-medium">
                      {formatMoney(row.totalOpCost, row.currency)}
                    </td>
                    <td className={cn('px-4 py-3 text-right text-sm', row.opCostPct != null && row.opCostPct > 100 && 'text-red-600')}>
                      {row.opCostPct == null ? '—' : row.opCostPct > 200 ? '>200%' : `${row.opCostPct.toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      — (needs COGS)
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
