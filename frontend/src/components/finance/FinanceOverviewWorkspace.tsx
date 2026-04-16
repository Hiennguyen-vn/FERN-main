import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  RefreshCw,
  Users,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  financeApi,
  payrollApi,
  type ExpenseView,
  type PayrollPeriodView,
  type PayrollRunView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';
import { getFinanceOutletDisplay } from '@/components/finance/finance-display';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
  onNavigate: (tab: string) => void;
}

function toNumber(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toNumber(value));
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

interface OverviewKpis {
  totalExpenses: number;
  totalPayroll: number;
  manualExpenses: number;
  payrollExpenses: number;
  invoiceExpenses: number;
  currency: string;
}

interface PeriodCloseStatus {
  total: number;
  approved: number;
  pending: number;
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

  const outletsById = useMemo(
    () => new Map(outlets.map((o) => [o.id, o])),
    [outlets],
  );

  const scopedRegionId = useMemo(() => {
    if (scopeRegionId) return scopeRegionId;
    if (!scopeOutletId) return '';
    return outlets.find((o) => o.id === scopeOutletId)?.regionId || '';
  }, [outlets, scopeOutletId, scopeRegionId]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [expPage, periodItems] = await Promise.all([
        financeApi.expenses(token, {
          outletId: scopeOutletId || undefined,
          limit: 200,
          sortBy: 'businessDate',
          sortDir: 'desc',
        }),
        collectPagedItems<PayrollPeriodView>(
          (q) => payrollApi.periods(token, q),
          { regionId: scopedRegionId || undefined, sortBy: 'startDate', sortDir: 'desc' },
          50,
        ),
      ]);

      const allExpenses = expPage.items || [];
      setExpenses(allExpenses);
      setPeriods(periodItems);

      if (periodItems.length > 0) {
        const recentPeriodId = periodItems[0]?.id;
        if (recentPeriodId) {
          const runItems = await collectPagedItems<PayrollRunView>(
            (q) => payrollApi.runs(token, q),
            {
              payrollPeriodId: recentPeriodId,
              outletId: scopeOutletId || undefined,
              sortBy: 'userId',
              sortDir: 'asc',
            },
            200,
          );
          setRuns(runItems);
        }
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load finance overview'));
    } finally {
      setLoading(false);
    }
  }, [token, scopeOutletId, scopedRegionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = useMemo((): OverviewKpis => {
    let totalExpenses = 0;
    let totalPayroll = 0;
    let manualExpenses = 0;
    let payrollExpenses = 0;
    let invoiceExpenses = 0;
    let currency = 'USD';

    for (const exp of expenses) {
      const amount = toNumber(exp.amount);
      const raw = String(exp.subtype || exp.sourceType || '').toLowerCase();
      if (exp.currencyCode) currency = exp.currencyCode;
      totalExpenses += amount;
      if (raw === 'payroll') {
        payrollExpenses += amount;
        totalPayroll += amount;
      } else if (raw.includes('invoice') || raw === 'inventory_purchase') {
        invoiceExpenses += amount;
      } else {
        manualExpenses += amount;
      }
    }

    return { totalExpenses, totalPayroll, manualExpenses, payrollExpenses, invoiceExpenses, currency };
  }, [expenses]);

  const closeStatus = useMemo((): PeriodCloseStatus => {
    const approved = runs.filter((r) => String(r.status || '').toLowerCase() === 'approved').length;
    return {
      total: runs.length,
      approved,
      pending: runs.length - approved,
    };
  }, [runs]);

  const recentPeriod = periods[0] ?? null;

  const recentExpenses = useMemo(
    () => expenses.slice(0, 8),
    [expenses],
  );

  const sourceMix = useMemo(() => {
    const total = kpis.totalExpenses;
    if (total === 0) return { manual: 0, payroll: 0, invoice: 0 };
    return {
      manual: Math.round((kpis.manualExpenses / total) * 100),
      payroll: Math.round((kpis.payrollExpenses / total) * 100),
      invoice: Math.round((kpis.invoiceExpenses / total) * 100),
    };
  }, [kpis]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Finance Overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Expense and payroll summary for current scope. Revenue and margin data available in Phase 2.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex h-8 items-center gap-1.5 rounded border px-3 text-xs hover:bg-accent disabled:opacity-60"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Phase 2 notice */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
        <span className="font-medium">Phase 1 (current):</span> Expense totals and payroll status are live.{' '}
        <span className="text-blue-700">Revenue, Labor %, and Prime Cost % will be available after sales-service integration (Phase 2).</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          label="Total Expenses"
          value={loading ? '—' : formatCurrency(kpis.totalExpenses, kpis.currency)}
          sub="Current scope, all time in view"
          onClick={() => onNavigate('expenses')}
        />
        <KpiCard
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          label="Payroll (in expenses)"
          value={loading ? '—' : formatCurrency(kpis.totalPayroll, kpis.currency)}
          sub="From approved payroll runs"
          onClick={() => onNavigate('labor')}
        />
        <KpiCard
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          label="Net Sales"
          value="— (Phase 2)"
          sub="Requires sales-service integration"
          muted
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
          label="Prime Cost %"
          value="— (Phase 2)"
          sub="Requires revenue + COGS data"
          muted
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        {/* Recent expenses table */}
        <div className="surface-elevated overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold">Recent expense rows</h3>
              <p className="text-xs text-muted-foreground">Last 8 entries across current scope</p>
            </div>
            <button
              onClick={() => onNavigate('expenses')}
              className="text-xs text-primary hover:underline"
            >
              View all →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Date', 'Outlet', 'Description', 'Source', 'Amount'].map((h) => (
                    <th
                      key={h}
                      className={cn(
                        'px-4 py-2.5 text-[11px] font-medium',
                        h === 'Amount' ? 'text-right' : 'text-left',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && recentExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : recentExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No expenses found for current scope
                    </td>
                  </tr>
                ) : (
                  recentExpenses.map((exp) => {
                    const outletDisplay = getFinanceOutletDisplay(outletsById, exp.outletId);
                    const src = sourceLabel(exp.sourceType, exp.subtype);
                    return (
                      <tr key={String(exp.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {String(exp.businessDate || '—')}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{outletDisplay.primary}</span>
                            {outletDisplay.secondary && (
                              <span className="text-[11px] font-mono text-muted-foreground">
                                {outletDisplay.secondary}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-sm max-w-[200px] truncate">
                          {String(exp.description || '—')}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium',
                              src.color,
                            )}
                          >
                            {src.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono whitespace-nowrap">
                          {formatCurrency(exp.amount, String(exp.currencyCode || 'USD'))}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Expense source mix */}
          <div className="surface-elevated px-5 py-4">
            <h3 className="mb-3 text-sm font-semibold">Expense sources</h3>
            {kpis.totalExpenses === 0 ? (
              <p className="text-xs text-muted-foreground">No expense data in current scope.</p>
            ) : (
              <div className="space-y-2.5">
                <SourceBar label="Manual entry" pct={sourceMix.manual} color="bg-blue-500" />
                <SourceBar label="Invoice-linked" pct={sourceMix.invoice} color="bg-orange-500" />
                <SourceBar label="Payroll-linked" pct={sourceMix.payroll} color="bg-purple-500" />
              </div>
            )}
            <button
              onClick={() => onNavigate('expenses')}
              className="mt-4 text-xs text-primary hover:underline"
            >
              View expense ledger →
            </button>
          </div>

          {/* Period close status */}
          <div className="surface-elevated px-5 py-4">
            <h3 className="mb-1 text-sm font-semibold">Latest payroll period</h3>
            {recentPeriod ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {String(recentPeriod.name || recentPeriod.startDate || '—')}
                </p>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    <span>{closeStatus.approved} approved</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5 text-amber-500" />
                    <span>{closeStatus.pending} pending</span>
                  </div>
                </div>
                {closeStatus.total > 0 && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-green-500 transition-all"
                      style={{ width: `${Math.round((closeStatus.approved / closeStatus.total) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No payroll periods in scope.</p>
            )}
            <button
              onClick={() => onNavigate('labor')}
              className="mt-4 text-xs text-primary hover:underline"
            >
              View payroll review →
            </button>
          </div>

          {/* Future metrics placeholder */}
          <div className="surface-elevated px-5 py-4 opacity-60">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Phase 2 metrics</h3>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>Labor % of sales — needs sales-service</p>
              <p>Prime Cost % — needs revenue + COGS</p>
              <p>Gross Margin — needs revenue data</p>
              <p>Outlet comparison heatmap</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  muted = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        'surface-elevated px-5 py-4',
        onClick && 'cursor-pointer hover:bg-accent/30 transition-colors',
        muted && 'opacity-60',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function SourceBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-1.5 rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
