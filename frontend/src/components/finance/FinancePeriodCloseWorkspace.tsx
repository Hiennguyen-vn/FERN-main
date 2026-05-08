import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
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
  type PayrollTimesheetView,
  type PayrollTimesheetsQuery,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';
import type { FinanceTab } from '@/components/finance/finance-workspace-config';
import {
  buildRevenueSnapshot,
  describeFinanceScope,
  formatPeriodLabel,
  getFinanceVisibleOutlets,
  getFinanceVarianceStatus,
  getPeriodKey,
  toNumber,
  type FinanceVarianceStatus,
} from '@/components/finance/finance-phase2-utils';
import { useFinanceSalesOrders } from '@/components/finance/use-finance-sales-orders';
import {
  inferPeriodWindowState,
  periodWindowBadgeClass,
  periodWindowLabel,
} from '@/components/payroll/payroll-truth';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
  onNavigate: (tab: FinanceTab) => void;
  canViewLabor: boolean;
}

interface OutletCloseRow {
  outletId: string;
  outletCode: string;
  outletName: string;
  payrollApproved: boolean;
  payrollApprovedAt?: string;
  payrollPending: number;
  payrollTotal: number;
  hasUncategorizedExpenses: boolean;
  uncategorizedCount: number;
  varianceStatus: FinanceVarianceStatus;
  varianceNeedsReview: boolean;
  varianceReviewed: boolean;
  varianceDetail: string;
  ready: boolean;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : `${value}T00:00:00`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function formatMonthYear(value?: string | null) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
}

function getLatestDate(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
}

function describeVarianceReview(params: {
  netSales: number;
  payroll: number;
  otherExpenses: number;
  laborPct: number | null;
  otherOpExPct: number | null;
}) {
  const {
    netSales,
    payroll,
    otherExpenses,
    laborPct,
    otherOpExPct,
  } = params;

  const status = getFinanceVarianceStatus(laborPct, otherOpExPct, netSales);
  if (status === 'risk') {
    return {
      status,
      needsReview: true,
      detail: laborPct != null && laborPct > 40
        ? `Labor is ${laborPct.toFixed(1)}% of sales.`
        : 'Operating costs need urgent finance review.',
    };
  }
  if (status === 'watch') {
    const parts: string[] = [];
    if (laborPct != null && laborPct > 35) {
      parts.push(`Labor ${laborPct.toFixed(1)}%`);
    }
    if (otherOpExPct != null && otherOpExPct > 25) {
      parts.push(`Other OpEx ${otherOpExPct.toFixed(1)}%`);
    }
    return {
      status,
      needsReview: true,
      detail: `${parts.join(' · ')} above target thresholds.`,
    };
  }
  if (status === 'no-sales' && (payroll > 0 || otherExpenses > 0)) {
    return {
      status,
      needsReview: true,
      detail: 'Costs posted with no recorded sales.',
    };
  }
  if (status === 'no-sales') {
    return {
      status,
      needsReview: false,
      detail: 'No finance activity in this period.',
    };
  }
  return {
    status,
    needsReview: false,
    detail: 'Variance within acceptable range.',
  };
}

export function FinancePeriodCloseWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
  onNavigate,
  canViewLabor,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [reviewedVarianceKeys, setReviewedVarianceKeys] = useState<Set<string>>(() => new Set());
  const [closing, setClosing] = useState(false);
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
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

  const regionsById = useMemo(() => new Map(regions.map((region) => [region.id, region])), [regions]);
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
  const scopedVisibleOutlets = useMemo(
    () => (
      visibleOutlets.length > 0
        ? visibleOutlets
        : getFinanceVisibleOutlets(outlets, scopeRegionId, scopeOutletId)
    ),
    [outlets, scopeOutletId, scopeRegionId, visibleOutlets],
  );

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );
  const activePeriodKey = useMemo(
    () => getPeriodKey(selectedPeriod?.startDate || selectedPeriod?.payDate),
    [selectedPeriod?.payDate, selectedPeriod?.startDate],
  );
  const markVarianceReviewed = useCallback((outletId: string) => {
    if (!selectedPeriodId) return;
    setReviewedVarianceKeys((current) => {
      const next = new Set(current);
      next.add(`${selectedPeriodId}:${outletId}`);
      return next;
    });
  }, [selectedPeriodId]);

  const loadPeriods = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const items = await collectPagedItems<PayrollPeriodView, PayrollPeriodsQuery>(
        (query) => payrollApi.periods(token, query),
        { regionId: scopedRegionId || undefined, sortBy: 'startDate', sortDir: 'desc' },
        50,
      );
      setPeriods(items);
      setSelectedPeriodId((current) => {
        if (current && items.some((period) => period.id === current)) return current;
        return items[0]?.id || '';
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load payroll periods'));
    } finally {
      setLoading(false);
    }
  }, [scopedRegionId, token]);

  const loadPeriodData = useCallback(async () => {
    if (!token || !selectedPeriodId || !selectedPeriod) {
      setTimesheets([]);
      setRuns([]);
      setExpenses([]);
      return;
    }

    setLoading(true);
    try {
      const [timesheetItems, runItems, expenseItems] = await Promise.all([
        collectPagedItems<PayrollTimesheetView, PayrollTimesheetsQuery>(
          (query) => payrollApi.timesheets(token, query),
          {
            payrollPeriodId: selectedPeriodId,
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
          500,
        ),
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (query) => payrollApi.runs(token, query),
          {
            payrollPeriodId: selectedPeriodId,
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
          500,
        ),
        collectPagedItems<ExpenseView, FinanceExpensesQuery>(
          (query) => financeApi.expenses(token, query),
          {
            outletId: scopeOutletId || undefined,
            startDate: selectedPeriod?.startDate || undefined,
            endDate: selectedPeriod?.endDate || undefined,
            sortBy: 'businessDate',
            sortDir: 'desc',
          },
          500,
          200,
        ),
      ]);

      setTimesheets(timesheetItems);
      setRuns(runItems);
      setExpenses(expenseItems);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load period data'));
    } finally {
      setLoading(false);
    }
  }, [scopeOutletId, selectedPeriod, selectedPeriodId, token]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    void loadPeriodData();
  }, [loadPeriodData]);

  const periodExpenses = useMemo(
    () => expenses.filter((expense) => getPeriodKey(expense.businessDate || expense.createdAt) === activePeriodKey),
    [activePeriodKey, expenses],
  );

  const revenueSnapshot = useMemo(() => {
    if (!activePeriodKey) {
      return {
        currency: 'USD',
        grossSales: 0,
        discounts: 0,
        refunds: 0,
        voids: 0,
        netSales: 0,
        completedOrderCount: 0,
        avgOrderValue: 0,
        paymentCoveragePct: 0,
        trend: [],
        outletRows: [],
        paymentMix: [],
        channelMix: [],
      };
    }

    return buildRevenueSnapshot({
      orders,
      visibleOutlets: scopedVisibleOutlets,
      periodKey: activePeriodKey,
      channelFilter: 'all',
    });
  }, [activePeriodKey, orders, scopedVisibleOutlets]);

  const revenueByOutlet = useMemo(
    () => new Map(revenueSnapshot.outletRows.map((row) => [row.outletId, row.netSales])),
    [revenueSnapshot.outletRows],
  );

  const outletRows = useMemo((): OutletCloseRow[] => {
    return scopedVisibleOutlets.map((outlet) => {
      const outletTimesheets = timesheets.filter((timesheet) => String(timesheet.outletId) === outlet.id);
      const outletRuns = runs.filter((run) => String(run.outletId) === outlet.id);
      // 'paid' is terminal state beyond 'approved' — count both as cleared.
      const approvedOrPaidRuns = outletRuns.filter((run) => {
        const s = String(run.status || '').toLowerCase();
        return s === 'approved' || s === 'paid';
      });
      // Runs submitted by HR but not yet approved/paid by Finance
      const pendingRuns = outletRuns.filter((run) => {
        const s = String(run.status || '').toLowerCase();
        return s !== 'approved' && s !== 'paid' && s !== 'rejected';
      }).length;
      const approvedRuns = approvedOrPaidRuns;
      // Timesheets where HR hasn't generated a run yet (waiting on HR, not Finance)
      const waitingOnHr = outletTimesheets.filter(
        (timesheet) => !outletRuns.some((run) => String(run.payrollTimesheetId) === timesheet.id),
      ).length;
      const outletExpenses = periodExpenses.filter((expense) => String(expense.outletId) === outlet.id);
      const uncategorizedCount = outletExpenses.filter((expense) => {
        const raw = String(expense.subtype || expense.sourceType || '').toLowerCase();
        const isSystemManaged = raw === 'payroll' || raw.includes('invoice') || raw === 'inventory_purchase';
        if (isSystemManaged) {
          return false;
        }
        return !String(expense.description || '').trim() || raw === '';
      }).length;
      const payrollApproved = outletRuns.length > 0 && approvedRuns.length === outletRuns.length && waitingOnHr === 0;
      const payrollAmount = approvedRuns.reduce((sum, run) => sum + toNumber(run.netSalary), 0);
      const otherExpenses = outletExpenses
        .filter((expense) => String(expense.subtype || expense.sourceType || '').toLowerCase() !== 'payroll')
        .reduce((sum, expense) => sum + toNumber(expense.amount), 0);
      const netSales = revenueByOutlet.get(outlet.id) || 0;
      const laborPct = netSales > 0 ? (payrollAmount / netSales) * 100 : null;
      const otherOpExPct = netSales > 0 ? (otherExpenses / netSales) * 100 : null;
      const variance = describeVarianceReview({
        netSales,
        payroll: payrollAmount,
        otherExpenses,
        laborPct,
        otherOpExPct,
      });
      const varianceReviewed = variance.needsReview
        ? reviewedVarianceKeys.has(`${selectedPeriodId}:${outlet.id}`)
        : false;

      return {
        outletId: outlet.id,
        outletCode: outlet.code || outlet.id,
        outletName: outlet.name || outlet.id,
        payrollApproved,
        payrollApprovedAt: getLatestDate(approvedRuns.map((run) => run.approvedAt || run.updatedAt || run.createdAt)),
        payrollPending: pendingRuns + waitingOnHr,
        payrollTotal: outletRuns.length,
        hasUncategorizedExpenses: uncategorizedCount > 0,
        uncategorizedCount,
        varianceStatus: variance.status,
        varianceNeedsReview: variance.needsReview,
        varianceReviewed,
        varianceDetail: variance.detail,
        ready: payrollApproved && uncategorizedCount === 0 && (!variance.needsReview || varianceReviewed),
      };
    });
  }, [periodExpenses, revenueByOutlet, reviewedVarianceKeys, runs, scopedVisibleOutlets, selectedPeriodId, timesheets]);

  const readyCount = outletRows.filter((row) => row.ready).length;
  const totalOutlets = outletRows.length;
  const readyPct = totalOutlets > 0 ? Math.round((readyCount / totalOutlets) * 100) : 0;
  const payrollBlockedCount = outletRows.filter((row) => !row.payrollApproved).length;
  const expenseBlockedCount = outletRows.filter((row) => row.hasUncategorizedExpenses).length;
  const varianceBlockedCount = outletRows.filter((row) => row.varianceNeedsReview && !row.varianceReviewed).length;
  const blockers = useMemo(
    () => outletRows.filter((row) => !row.ready),
    [outletRows],
  );

  const periodLabel = selectedPeriod
    ? String(selectedPeriod.name || formatMonthYear(selectedPeriod.startDate))
    : 'current period';
  const periodClosed = String(selectedPeriod?.status || '').toLowerCase() === 'closed';
  const visibleReadyPct = periodClosed ? 100 : readyPct;
  const visiblePayrollBlockedCount = periodClosed ? 0 : payrollBlockedCount;
  const visibleExpenseBlockedCount = periodClosed ? 0 : expenseBlockedCount;
  const visibleVarianceBlockedCount = periodClosed ? 0 : varianceBlockedCount;
  const visibleBlockers = periodClosed ? [] : blockers;
  const periodReady = readyCount === totalOutlets && totalOutlets > 0;
  const closeDisabledReason = periodClosed
    ? 'This period is closed. New finance entries inside the period are locked.'
    : periodReady
      ? 'All outlet checks are clear. Closing will lock this period for new expense entries.'
      : `${Math.max(totalOutlets - readyCount, 0)} outlet(s) still have open blockers.`;

  const closePeriod = useCallback(async () => {
    if (!token || !selectedPeriodId || !periodReady || periodClosed) return;
    setClosing(true);
    setError('');
    try {
      const updated = await payrollApi.closePeriod(token, selectedPeriodId);
      setPeriods((current) => current.map((period) => (period.id === updated.id ? updated : period)));
      toast.success('Period closed. Finance entries in this window are now locked.');
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Unable to close period');
      setError(message);
      toast.error(message);
    } finally {
      setClosing(false);
    }
  }, [periodClosed, periodReady, selectedPeriodId, token]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{scopeLabel}</h2>
          <p className="text-xs text-muted-foreground">Period close checklist — payroll, expenses, and variance review</p>
        </div>
        <button
          onClick={() => { void loadPeriods(); void loadPeriodData(); void refreshSales(); }}
          disabled={loading || salesLoading}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-accent disabled:opacity-60"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', (loading || salesLoading) && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {(error || salesError) ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          {[error, salesError].filter(Boolean).join(' · ')}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="surface-elevated overflow-hidden">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Payroll periods</h3>
          </div>
          {loading && periods.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">Loading periods…</div>
          ) : periods.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">
              No payroll periods found in scope.
            </div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              {periods.map((period) => {
                const state = inferPeriodWindowState(period);
                const closed = String(period.status || '').toLowerCase() === 'closed';
                const regionName = regionsById.get(String(period.regionId || ''))?.name || '';
                const selected = period.id === selectedPeriodId;
                return (
                  <button
                    key={period.id}
                    type="button"
                    onClick={() => setSelectedPeriodId(period.id)}
                    className={cn(
                      'w-full border-b px-5 py-4 text-left transition-colors hover:bg-accent/30',
                      selected ? 'bg-accent/40' : 'bg-background',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {String(period.name || formatMonthYear(period.startDate))}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{regionName}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Pay {formatDate(period.payDate)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                          closed ? 'border-slate-200 bg-slate-100 text-slate-700' : periodWindowBadgeClass(state),
                        )}
                      >
                        {closed ? 'Closed' : periodWindowLabel(state)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <div className="space-y-4">
          {selectedPeriod ? (
            <>
              <div className="surface-elevated px-5 py-5">
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-base font-semibold">{periodLabel}</h3>
                  <span
                    className={cn(
                      'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium',
                      periodClosed
                        ? 'border-slate-200 bg-slate-100 text-slate-700'
                        : readyCount === totalOutlets && totalOutlets > 0
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700',
                    )}
                  >
                    {periodClosed ? 'Closed' : `${readyCount}/${totalOutlets} outlets ready`}
                  </span>
                </div>
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-2.5 rounded-full transition-all',
                      periodClosed
                        ? 'bg-slate-500'
                        : visibleReadyPct === 100
                        ? 'bg-green-500'
                        : visibleReadyPct >= 50
                        ? 'bg-amber-500'
                        : 'bg-red-500',
                    )}
                    style={{ width: `${visibleReadyPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {periodClosed ? 'Closed period' : `${visibleReadyPct}% ready to close`}
                </p>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <CloseSignalRail
                    label="Payroll blockers"
                    value={String(visiblePayrollBlockedCount)}
                    detail={periodClosed
                      ? 'Locked with the closed period'
                      : visiblePayrollBlockedCount === 1
                      ? '1 outlet awaiting payroll approval'
                      : `${visiblePayrollBlockedCount} outlets awaiting payroll approval`}
                    tone={visiblePayrollBlockedCount > 0 ? 'warning' : 'default'}
                  />
                  <CloseSignalRail
                    label="Expense blockers"
                    value={String(visibleExpenseBlockedCount)}
                    detail={periodClosed ? 'Locked with the closed period' : 'Rows need description or subtype'}
                    tone={visibleExpenseBlockedCount > 0 ? 'warning' : 'default'}
                  />
                  <CloseSignalRail
                    label="Variance review"
                    value={String(visibleVarianceBlockedCount)}
                    detail={periodClosed
                      ? 'Locked with the closed period'
                      : activePeriodKey
                      ? `Outlets above target — ${formatPeriodLabel(activePeriodKey)}`
                      : 'Needs a payroll period date'}
                    tone={visibleVarianceBlockedCount > 0 ? 'warning' : 'default'}
                  />
                </div>

                {periodReady || periodClosed ? (
                  <div className={cn(
                    'mt-4 rounded-lg border px-4 py-3 text-sm',
                    periodClosed
                      ? 'border-slate-200 bg-slate-50 text-slate-800'
                      : 'border-green-200 bg-green-50/70 text-green-800',
                  )}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className={cn('h-4 w-4', periodClosed ? 'text-slate-600' : 'text-green-600')} />
                        <span className="font-medium">{periodClosed ? 'Period closed.' : 'All outlets ready.'}</span>
                      </div>
                      <button
                        className="h-8 rounded-md bg-green-700 px-4 text-xs font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
                        title={closeDisabledReason}
                        disabled={periodClosed || closing}
                        onClick={() => void closePeriod()}
                      >
                        {periodClosed ? 'Closed' : closing ? 'Closing…' : 'Close Period'}
                      </button>
                    </div>
                    <p className={cn('mt-1 text-xs', periodClosed ? 'text-slate-600' : 'text-green-700/70')}>
                      {closeDisabledReason}
                    </p>
                  </div>
                ) : (totalOutlets > 0 && !loading) ? (
                  <div className="mt-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs">
                        {readyCount < totalOutlets
                          ? `${totalOutlets - readyCount} outlet(s) still have open blockers.`
                          : 'Select a period to check readiness.'}
                      </span>
                      <button
                        className="h-8 rounded-md border px-4 text-xs font-medium opacity-50 cursor-not-allowed"
                        disabled
                        title={closeDisabledReason}
                      >
                        Close Period
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="surface-elevated overflow-hidden">
                <div className="border-b px-5 py-4">
                  <h3 className="text-sm font-semibold">Outlet checklist</h3>
                  <p className="text-xs text-muted-foreground">
                    Payroll, expense hygiene, and variance review status for {periodLabel}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {['Outlet', 'Payroll runs', 'Expenses', 'Variance reviewed', 'Status'].map((header) => (
                          <th key={header} className="px-4 py-2.5 text-left text-[11px] font-medium">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loading && outletRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                            Loading…
                          </td>
                        </tr>
                      ) : outletRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                            No outlets in scope for this period.
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
                            <td className="px-4 py-3">
                              {row.payrollTotal === 0 ? (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Clock className="h-3.5 w-3.5" />
                                  No activity
                                </div>
                              ) : row.payrollApproved ? (
                                <div className="flex items-center gap-1.5 text-xs text-green-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {row.payrollApprovedAt ? `Approved ${formatDate(row.payrollApprovedAt)}` : `${row.payrollTotal} approved`}
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  {row.payrollPending > 0 && (
                                    <div className="flex items-center gap-1.5 text-xs text-amber-700">
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                      {row.payrollPending} awaiting approval
                                    </div>
                                  )}
                                  {row.payrollPending === 0 && (
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <Clock className="h-3.5 w-3.5" />
                                      Waiting on HR
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {row.hasUncategorizedExpenses ? (
                                <div className="flex items-center gap-1.5 text-xs text-amber-700">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {row.uncategorizedCount} need review
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-xs text-green-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  OK
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <VarianceStatusBadge
                                status={row.varianceStatus}
                                needsReview={periodClosed ? false : row.varianceNeedsReview}
                                reviewed={periodClosed ? true : row.varianceReviewed}
                              />
                            </td>
                            <td className="px-4 py-3">
                              {periodClosed ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Closed
                                </span>
                              ) : row.ready ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Ready
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                                  <AlertTriangle className="h-3 w-3" />
                                  Pending
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {visibleBlockers.length > 0 ? (
                <div className="surface-elevated px-5 py-4">
                  <h3 className="mb-3 text-sm font-semibold">Blockers to resolve</h3>
                  <div className="space-y-3">
                    {visibleBlockers.map((row) => (
                      <div key={row.outletId} className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
                        <p className="text-sm font-medium text-amber-900">
                          {row.outletCode} · {row.outletName}
                        </p>
                        <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
                          {!row.payrollApproved && row.payrollPending > 0 ? (
                            <li className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3" />
                              {row.payrollPending} payroll run(s) pending approval
                              {canViewLabor ? (
                                <button
                                  onClick={() => onNavigate('labor')}
                                  className="ml-1 underline hover:no-underline"
                                >
                                  → Review payroll
                                </button>
                              ) : null}
                            </li>
                          ) : null}
                          {row.payrollTotal === 0 ? (
                            <li className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3" />
                              No payroll runs exist for this outlet in this period
                            </li>
                          ) : null}
                          {row.hasUncategorizedExpenses ? (
                            <li className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3" />
                              {row.uncategorizedCount} expense row(s) need description or subtype
                              <button
                                onClick={() => onNavigate('expenses')}
                                className="ml-1 underline hover:no-underline"
                              >
                                → View expenses
                              </button>
                            </li>
                          ) : null}
                          {row.varianceNeedsReview && !row.varianceReviewed ? (
                            <li className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3" />
                              {row.varianceDetail}
                              <button
                                onClick={() => onNavigate('expenses')}
                                className="ml-1 underline hover:no-underline"
                              >
                                → Review variance
                              </button>
                              <button
                                type="button"
                                onClick={() => markVarianceReviewed(row.outletId)}
                                className="ml-1 rounded border border-amber-300 bg-background px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                              >
                                Mark reviewed
                              </button>
                            </li>
                          ) : null}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="surface-elevated px-5 py-12 text-center text-sm text-muted-foreground">
              Select a payroll period on the left to view close readiness.
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Period close locks the books for the selected period. Review all outlet checklists above before closing.
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseSignalRail({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="rounded-xl border bg-background/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tracking-tight', tone === 'warning' && 'text-amber-700')}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function VarianceStatusBadge({
  status,
  needsReview,
  reviewed,
}: {
  status: FinanceVarianceStatus;
  needsReview: boolean;
  reviewed?: boolean;
}) {
  if (reviewed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700">
        <CheckCircle2 className="h-3 w-3" />
        Reviewed
      </span>
    );
  }
  if (status === 'risk') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" />
        Urgent review
      </span>
    );
  }
  if (needsReview) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        Review needed
      </span>
    );
  }
  if (status === 'no-sales') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        No activity
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700">
      <CheckCircle2 className="h-3 w-3" />
      Clear
    </span>
  );
}
