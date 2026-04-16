import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  financeApi,
  payrollApi,
  type ExpenseView,
  type PayrollRunView,
  type PayrollRunsQuery,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';
import {
  buildRevenueSnapshot,
  formatPeriodLabel,
  getFinanceVisibleOutlets,
  getPeriodKey,
  toNumber,
} from '@/components/finance/finance-phase2-utils';
import { useFinanceSalesOrders } from '@/components/finance/use-finance-sales-orders';
import {
  formatMoney,
  formatMoneyExact,
  laborVarianceLevel,
  opexVarianceLevel,
  toNum,
} from '@/components/finance/finance-utils';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}

interface PLOutletRow {
  outletId: string;
  outletCode: string;
  outletName: string;
  netSales: number;
  payroll: number;
  opEx: number;
  totalCosts: number;
  income: number;
  laborPct: number | null;
  opExPct: number | null;
  incomePct: number | null;
}

function pctColor(pct: number | null, type: 'labor' | 'opex' | 'income'): string {
  if (pct == null) return 'text-muted-foreground';
  if (type === 'income') {
    if (pct < 0) return 'text-red-600 font-medium';
    if (pct < 10) return 'text-amber-700';
    return 'text-green-700';
  }
  const level = type === 'labor' ? laborVarianceLevel(pct) : opexVarianceLevel(pct);
  if (level === 'risk') return 'text-red-600 font-medium';
  if (level === 'watch') return 'text-amber-700';
  return 'text-muted-foreground';
}

function PctCell({ pct, type }: { pct: number | null; type: 'labor' | 'opex' | 'income' }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={pctColor(pct, type)}>
      {pct > 200 ? '>200%' : `${pct.toFixed(1)}%`}
    </span>
  );
}

function PLRow({
  label,
  amount,
  pct,
  pctType,
  currency,
  indent = false,
  bold = false,
  divider = false,
}: {
  label: string;
  amount: number;
  pct?: number | null;
  pctType?: 'labor' | 'opex' | 'income';
  currency: string;
  indent?: boolean;
  bold?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between py-2',
        indent && 'pl-6',
        bold && 'font-semibold',
        divider && 'border-t border-border mt-1 pt-3',
      )}
    >
      <span className={cn('text-sm', !bold && 'text-muted-foreground', indent && !bold && 'text-foreground/80')}>
        {label}
      </span>
      <div className="flex items-center gap-6 tabular-nums">
        <span className={cn('text-sm font-mono', bold && 'font-semibold', amount < 0 && 'text-red-600')}>
          {amount < 0 ? `-${formatMoneyExact(Math.abs(amount), currency)}` : formatMoneyExact(amount, currency)}
        </span>
        <span className={cn('w-16 text-right text-xs', pctType ? pctColor(pct ?? null, pctType) : 'text-muted-foreground')}>
          {pct != null ? (pct > 200 ? '>200%' : `${pct.toFixed(1)}%`) : ''}
        </span>
      </div>
    </div>
  );
}

export function FinancePLWorkspace({
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
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('');

  const {
    orders,
    visibleOutlets,
    loading: salesLoading,
    error: salesError,
    refresh: refreshSales,
  } = useFinanceSalesOrders({ token, scopeRegionId, scopeOutletId, outlets });

  const scopedVisibleOutlets = useMemo(
    () => getFinanceVisibleOutlets(outlets, scopeRegionId, scopeOutletId),
    [outlets, scopeRegionId, scopeOutletId],
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [expPage, runItems] = await Promise.all([
        financeApi.expenses(token, {
          outletId: scopeOutletId || undefined,
          limit: 500,
          sortBy: 'businessDate',
          sortDir: 'desc',
        }),
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (q) => payrollApi.runs(token, q),
          {
            outletId: scopeOutletId || undefined,
            status: 'approved',
            sortBy: 'createdAt',
            sortDir: 'desc',
          },
          500,
        ).catch(() => [] as PayrollRunView[]),
      ]);
      setExpenses(expPage.items || []);
      setRuns(runItems);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load P&L data'));
    } finally {
      setLoading(false);
    }
  }, [token, scopeOutletId]);

  useEffect(() => { void load(); }, [load]);

  const availablePeriods = useMemo(() => {
    const keys = new Set<string>();
    for (const o of orders) {
      const k = getPeriodKey(o.createdAt);
      if (k) keys.add(k);
    }
    for (const e of expenses) {
      const k = getPeriodKey(e.businessDate || e.createdAt);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [orders, expenses]);

  useEffect(() => {
    if (!selectedPeriodKey && availablePeriods.length > 0) {
      setSelectedPeriodKey(availablePeriods[0]);
    }
  }, [availablePeriods, selectedPeriodKey]);

  const plData = useMemo(() => {
    if (!selectedPeriodKey) return null;

    const snapshot = buildRevenueSnapshot({
      orders,
      visibleOutlets,
      periodKey: selectedPeriodKey,
      channelFilter: 'all',
    });

    const visibleIds = new Set(scopedVisibleOutlets.map((o) => o.id));

    const periodExpenses = expenses.filter((e) => {
      const k = getPeriodKey(e.businessDate || e.createdAt);
      if (k !== selectedPeriodKey) return false;
      return visibleIds.size === 0 || visibleIds.has(String(e.outletId ?? ''));
    });

    const periodRuns = runs.filter((r) => {
      if (String(r.status || '').toLowerCase() !== 'approved') return false;
      const k = getPeriodKey(r.approvedAt || r.createdAt);
      if (k !== selectedPeriodKey) return false;
      return visibleIds.size === 0 || visibleIds.has(String(r.outletId ?? ''));
    });

    const payrollCost = periodRuns.reduce((s, r) => s + toNum(r.netSalary), 0);

    const invoiceExpenses = periodExpenses
      .filter((e) => String(e.subtype || e.sourceType || '').toLowerCase().includes('invoice'))
      .reduce((s, e) => s + toNum(e.amount), 0);

    const manualExpenses = periodExpenses
      .filter((e) => {
        const t = String(e.subtype || e.sourceType || '').toLowerCase();
        return t !== 'payroll' && !t.includes('invoice') && t !== 'inventory_purchase';
      })
      .reduce((s, e) => s + toNum(e.amount), 0);

    const inventoryExpenses = periodExpenses
      .filter((e) => String(e.subtype || e.sourceType || '').toLowerCase() === 'inventory_purchase')
      .reduce((s, e) => s + toNum(e.amount), 0);

    const totalOpEx = invoiceExpenses + manualExpenses + inventoryExpenses;
    const totalCosts = payrollCost + totalOpEx;
    const operatingIncome = snapshot.netSales - totalCosts;
    const ns = snapshot.netSales;

    const outletRows: PLOutletRow[] = scopedVisibleOutlets
      .map((outlet) => {
        const rev = snapshot.outletRows.find((r) => r.outletId === outlet.id);
        const outletNs = rev?.netSales ?? 0;
        const outletPay = periodRuns
          .filter((r) => String(r.outletId) === outlet.id)
          .reduce((s, r) => s + toNum(r.netSalary), 0);
        const outletOpEx = periodExpenses
          .filter((e) => {
            if (String(e.outletId) !== outlet.id) return false;
            return String(e.subtype || e.sourceType || '').toLowerCase() !== 'payroll';
          })
          .reduce((s, e) => s + toNum(e.amount), 0);
        const outletIncome = outletNs - outletPay - outletOpEx;
        return {
          outletId: outlet.id,
          outletCode: outlet.code || outlet.id,
          outletName: outlet.name || outlet.id,
          netSales: outletNs,
          payroll: outletPay,
          opEx: outletOpEx,
          totalCosts: outletPay + outletOpEx,
          income: outletIncome,
          laborPct: outletNs > 0 ? (outletPay / outletNs) * 100 : null,
          opExPct: outletNs > 0 ? (outletOpEx / outletNs) * 100 : null,
          incomePct: outletNs > 0 ? (outletIncome / outletNs) * 100 : null,
        };
      })
      .filter((r) => r.netSales > 0 || r.payroll > 0 || r.opEx > 0)
      .sort((a, b) => b.netSales - a.netSales);

    return {
      currency: snapshot.currency || 'VND',
      grossSales: snapshot.grossSales,
      discounts: snapshot.discounts,
      netSales: ns,
      completedOrders: snapshot.completedOrderCount,
      payrollCost,
      invoiceExpenses,
      manualExpenses,
      inventoryExpenses,
      totalOpEx,
      totalCosts,
      operatingIncome,
      laborPct: ns > 0 ? (payrollCost / ns) * 100 : null,
      opExPct: ns > 0 ? (totalOpEx / ns) * 100 : null,
      incomePct: ns > 0 ? (operatingIncome / ns) * 100 : null,
      outletRows,
    };
  }, [selectedPeriodKey, orders, visibleOutlets, expenses, runs, scopedVisibleOutlets]);

  const isLoading = loading || salesLoading;
  const combinedError = [error, salesError].filter(Boolean).join(' · ');

  const scopeLabel = useMemo(() => {
    if (scopeOutletId) {
      const o = outlets.find((x) => x.id === scopeOutletId);
      return o?.name || o?.code || 'Outlet';
    }
    if (scopeRegionId) {
      return regions.find((r) => r.id === scopeRegionId)?.name || 'Region';
    }
    return 'All outlets';
  }, [outlets, regions, scopeOutletId, scopeRegionId]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{scopeLabel}</h2>
          <p className="text-xs text-muted-foreground">
            {plData
              ? `${formatPeriodLabel(selectedPeriodKey)} · ${plData.completedOrders} completed orders`
              : 'Profit & Loss Summary'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
            value={selectedPeriodKey}
            onChange={(e) => setSelectedPeriodKey(e.target.value)}
            disabled={availablePeriods.length === 0}
          >
            {availablePeriods.length === 0 ? (
              <option value="">No data available</option>
            ) : (
              availablePeriods.map((k) => (
                <option key={k} value={k}>{formatPeriodLabel(k)}</option>
              ))
            )}
          </select>
          <button
            onClick={() => { void load(); void refreshSales(); }}
            disabled={isLoading}
            className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {combinedError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {combinedError}
        </div>
      )}

      {!plData && !isLoading && (
        <div className="surface-elevated flex flex-col items-center justify-center px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">No data available for this period.</p>
          <p className="mt-1 text-xs text-muted-foreground">Orders and expenses will appear here once recorded.</p>
        </div>
      )}

      {plData && (
        <>
          {/* P&L Statement */}
          <section className="surface-elevated overflow-hidden">
            <div className="border-b px-6 py-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">P&L Statement</h3>
                <span className="text-xs text-muted-foreground">{formatPeriodLabel(selectedPeriodKey)}</span>
              </div>
            </div>

            <div className="px-6 py-2">
              {/* Column headers */}
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Line item</span>
                <div className="flex items-center gap-6">
                  <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Amount</span>
                  <span className="w-16 text-right text-[11px] uppercase tracking-[0.15em] text-muted-foreground">% Sales</span>
                </div>
              </div>

              {/* REVENUE */}
              <div className="mt-2">
                <p className="py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Revenue</p>
                <PLRow label="Gross Sales" amount={plData.grossSales} currency={plData.currency} indent />
                {plData.discounts > 0 && (
                  <PLRow label="Discounts" amount={-plData.discounts} currency={plData.currency} indent />
                )}
                <PLRow
                  label="Net Sales"
                  amount={plData.netSales}
                  pct={100}
                  currency={plData.currency}
                  bold
                />
              </div>

              {/* COST OF LABOR */}
              <div className="mt-3">
                <p className="py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Cost of Labor</p>
                <PLRow
                  label="Approved Payroll"
                  amount={plData.payrollCost}
                  pct={plData.laborPct}
                  pctType="labor"
                  currency={plData.currency}
                  indent
                />
              </div>

              {/* OPERATING EXPENSES */}
              <div className="mt-3">
                <p className="py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Operating Expenses</p>
                {plData.invoiceExpenses > 0 && (
                  <PLRow label="Invoice-linked" amount={plData.invoiceExpenses} currency={plData.currency} indent />
                )}
                {plData.inventoryExpenses > 0 && (
                  <PLRow label="Inventory purchases" amount={plData.inventoryExpenses} currency={plData.currency} indent />
                )}
                <PLRow label="Manual entries" amount={plData.manualExpenses} currency={plData.currency} indent />
                <PLRow
                  label="Total Operating Expenses"
                  amount={plData.totalOpEx}
                  pct={plData.opExPct}
                  pctType="opex"
                  currency={plData.currency}
                  bold
                />
              </div>

              {/* TOTALS */}
              <div className="mt-3 border-t pt-3">
                <PLRow
                  label="Total Costs"
                  amount={plData.totalCosts}
                  pct={plData.laborPct != null && plData.opExPct != null ? plData.laborPct + plData.opExPct : null}
                  currency={plData.currency}
                  bold
                />
                <div className={cn(
                  'mt-1 flex items-center justify-between rounded-lg px-3 py-3',
                  plData.operatingIncome < 0
                    ? 'bg-red-50 border border-red-200'
                    : plData.incomePct != null && plData.incomePct < 10
                      ? 'bg-amber-50 border border-amber-200'
                      : 'bg-green-50 border border-green-200',
                )}>
                  <div className="flex items-center gap-2">
                    {plData.operatingIncome < 0
                      ? <TrendingDown className="h-4 w-4 text-red-600" />
                      : <TrendingUp className="h-4 w-4 text-green-600" />}
                    <span className={cn(
                      'text-sm font-semibold',
                      plData.operatingIncome < 0 ? 'text-red-700' : 'text-green-700',
                    )}>
                      Operating Income
                    </span>
                  </div>
                  <div className="flex items-center gap-6 tabular-nums">
                    <span className={cn(
                      'text-sm font-mono font-semibold',
                      plData.operatingIncome < 0 ? 'text-red-700' : 'text-green-700',
                    )}>
                      {plData.operatingIncome < 0
                        ? `-${formatMoneyExact(Math.abs(plData.operatingIncome), plData.currency)}`
                        : formatMoneyExact(plData.operatingIncome, plData.currency)}
                    </span>
                    <span className={cn(
                      'w-16 text-right text-xs font-medium',
                      plData.operatingIncome < 0 ? 'text-red-600' : 'text-green-700',
                    )}>
                      {plData.incomePct != null
                        ? `${plData.incomePct > 200 ? '>200' : plData.incomePct.toFixed(1)}%`
                        : ''}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 pb-4" />
          </section>

          {/* Per-outlet breakdown */}
          {plData.outletRows.length > 0 && (
            <section className="surface-elevated overflow-hidden">
              <div className="border-b px-6 py-4">
                <h3 className="text-sm font-semibold">By Outlet</h3>
                <p className="text-xs text-muted-foreground">
                  Revenue, labor, and operating costs per outlet for {formatPeriodLabel(selectedPeriodKey)}.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Outlet', 'Net Sales', 'Payroll', 'Labor %', 'Operating Costs', 'OpEx %', 'Operating Income', 'Margin'].map((h) => (
                        <th
                          key={h}
                          className={cn(
                            'px-4 py-2.5 text-[11px] font-medium text-muted-foreground',
                            h === 'Outlet' ? 'text-left' : 'text-right',
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plData.outletRows.map((row) => (
                      <tr key={row.outletId} className="border-b last:border-0 hover:bg-accent/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{row.outletName}</span>
                            <span className="text-[11px] text-muted-foreground">{row.outletCode}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {formatMoney(row.netSales, plData.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {row.payroll > 0 ? formatMoney(row.payroll, plData.currency) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-sm">
                          <PctCell pct={row.laborPct} type="labor" />
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {row.opEx > 0 ? formatMoney(row.opEx, plData.currency) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-sm">
                          <PctCell pct={row.opExPct} type="opex" />
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right font-mono text-sm',
                          row.income < 0 ? 'text-red-600' : 'text-green-700',
                        )}>
                          {row.income < 0
                            ? `-${formatMoney(Math.abs(row.income), plData.currency)}`
                            : formatMoney(row.income, plData.currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm">
                          <PctCell pct={row.incomePct} type="income" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {plData.outletRows.length > 1 && (
                    <tfoot className="border-t bg-muted/20">
                      <tr>
                        <td className="px-4 py-2.5 text-xs font-semibold">Total</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold">
                          {formatMoney(plData.netSales, plData.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold">
                          {formatMoney(plData.payrollCost, plData.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm">
                          <PctCell pct={plData.laborPct} type="labor" />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold">
                          {formatMoney(plData.totalOpEx, plData.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm">
                          <PctCell pct={plData.opExPct} type="opex" />
                        </td>
                        <td className={cn(
                          'px-4 py-2.5 text-right font-mono text-sm font-semibold',
                          plData.operatingIncome < 0 ? 'text-red-600' : 'text-green-700',
                        )}>
                          {plData.operatingIncome < 0
                            ? `-${formatMoney(Math.abs(plData.operatingIncome), plData.currency)}`
                            : formatMoney(plData.operatingIncome, plData.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm">
                          <PctCell pct={plData.incomePct} type="income" />
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          )}

          {plData.outletRows.length === 0 && (
            <div className="surface-elevated flex flex-col items-center justify-center px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">No outlet data available for {formatPeriodLabel(selectedPeriodKey)}.</p>
            </div>
          )}
        </>
      )}

      {isLoading && !plData && (
        <div className="surface-elevated flex items-center justify-center py-16 text-sm text-muted-foreground">
          Loading P&L data…
        </div>
      )}
    </div>
  );
}
