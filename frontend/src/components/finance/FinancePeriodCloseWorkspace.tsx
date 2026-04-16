import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  financeApi,
  payrollApi,
  type ExpenseView,
  type PayrollPeriodView,
  type PayrollRunView,
  type PayrollTimesheetView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';
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
  onNavigate: (tab: string) => void;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function formatMonthYear(value?: string | null) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
}

interface OutletCloseRow {
  outletId: string;
  outletCode: string;
  outletName: string;
  payrollApproved: boolean;
  payrollPending: number;
  payrollTotal: number;
  hasUncategorizedExpenses: boolean;
  uncategorizedCount: number;
  ready: boolean;
}

export function FinancePeriodCloseWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
  onNavigate,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);

  const scopedRegionId = useMemo(() => {
    if (scopeRegionId) return scopeRegionId;
    if (!scopeOutletId) return '';
    return outlets.find((o) => o.id === scopeOutletId)?.regionId || '';
  }, [outlets, scopeOutletId, scopeRegionId]);

  const regionsById = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  const outletsById = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const loadPeriods = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const items = await collectPagedItems<PayrollPeriodView>(
        (q) => payrollApi.periods(token, q),
        { regionId: scopedRegionId || undefined, sortBy: 'startDate', sortDir: 'desc' },
        50,
      );
      setPeriods(items);
      setSelectedPeriodId((curr) => {
        if (curr && items.some((p) => p.id === curr)) return curr;
        return items[0]?.id || '';
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load payroll periods'));
    } finally {
      setLoading(false);
    }
  }, [token, scopedRegionId]);

  const loadPeriodData = useCallback(async () => {
    if (!token || !selectedPeriodId) {
      setTimesheets([]);
      setRuns([]);
      setExpenses([]);
      return;
    }
    setLoading(true);
    try {
      const [tsItems, runItems, expPage] = await Promise.all([
        collectPagedItems<PayrollTimesheetView>(
          (q) => payrollApi.timesheets(token, q),
          {
            payrollPeriodId: selectedPeriodId,
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
          500,
        ),
        collectPagedItems<PayrollRunView>(
          (q) => payrollApi.runs(token, q),
          {
            payrollPeriodId: selectedPeriodId,
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
          500,
        ),
        financeApi.expenses(token, {
          outletId: scopeOutletId || undefined,
          limit: 500,
          sortBy: 'businessDate',
          sortDir: 'desc',
        }),
      ]);
      setTimesheets(tsItems);
      setRuns(runItems);
      setExpenses(expPage.items || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load period data'));
    } finally {
      setLoading(false);
    }
  }, [token, selectedPeriodId, scopeOutletId]);

  useEffect(() => { void loadPeriods(); }, [loadPeriods]);
  useEffect(() => { void loadPeriodData(); }, [loadPeriodData]);

  // Build per-outlet close status rows
  const outletRows = useMemo((): OutletCloseRow[] => {
    const relevantOutlets = scopeOutletId
      ? outlets.filter((o) => o.id === scopeOutletId)
      : outlets.filter((o) => !scopedRegionId || o.regionId === scopedRegionId);

    return relevantOutlets.map((outlet): OutletCloseRow => {
      const outletTs = timesheets.filter((ts) => String(ts.outletId) === outlet.id);
      const outletRuns = runs.filter((r) => String(r.outletId) === outlet.id);
      const approvedRuns = outletRuns.filter((r) => String(r.status || '').toLowerCase() === 'approved').length;
      const pendingRuns = outletRuns.filter((r) => String(r.status || '').toLowerCase() === 'draft').length;
      const waitingOnHr = outletTs.filter((ts) => !outletRuns.some((r) => String(r.payrollTimesheetId) === ts.id)).length;

      // "Uncategorized" = no description or subtype is null/empty for manual rows
      const outletExpenses = expenses.filter(
        (exp) => String(exp.outletId) === outlet.id,
      );
      const uncategorized = outletExpenses.filter(
        (exp) =>
          !String(exp.description || '').trim() ||
          String(exp.subtype || exp.sourceType || '').toLowerCase() === '',
      ).length;

      const payrollApproved = outletRuns.length > 0 && pendingRuns === 0 && waitingOnHr === 0;

      return {
        outletId: outlet.id,
        outletCode: outlet.code || outlet.id,
        outletName: outlet.name || outlet.id,
        payrollApproved,
        payrollPending: pendingRuns + waitingOnHr,
        payrollTotal: outletRuns.length,
        hasUncategorizedExpenses: uncategorized > 0,
        uncategorizedCount: uncategorized,
        ready: payrollApproved && uncategorized === 0,
      };
    });
  }, [outlets, scopeOutletId, scopedRegionId, timesheets, runs, expenses]);

  const readyCount = outletRows.filter((r) => r.ready).length;
  const totalOutlets = outletRows.length;
  const readyPct = totalOutlets > 0 ? Math.round((readyCount / totalOutlets) * 100) : 0;

  const blockers = useMemo(
    () => outletRows.filter((r) => !r.ready),
    [outletRows],
  );

  const periodLabel = selectedPeriod
    ? String(selectedPeriod.name || formatMonthYear(selectedPeriod.startDate))
    : 'current period';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="surface-elevated px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Period Close</h3>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              Track readiness per outlet before closing a payroll period. All payroll runs must be approved
              and expense rows must have descriptions before an outlet is considered ready.
            </p>
          </div>
          <button
            onClick={() => { void loadPeriods(); void loadPeriodData(); }}
            disabled={loading}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded border px-3 text-xs hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* Period selector */}
        <aside className="surface-elevated overflow-hidden">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>Payroll periods</span>
            </div>
            <h3 className="mt-2 text-base font-semibold">Select period</h3>
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
                          periodWindowBadgeClass(state),
                        )}
                      >
                        {periodWindowLabel(state)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Main content */}
        <div className="space-y-4">
          {selectedPeriod ? (
            <>
              {/* Readiness overview */}
              <div className="surface-elevated px-5 py-5">
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-base font-semibold">{periodLabel}</h3>
                  <span
                    className={cn(
                      'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium',
                      readyCount === totalOutlets && totalOutlets > 0
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700',
                    )}
                  >
                    {readyCount}/{totalOutlets} outlets ready
                  </span>
                </div>
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-2.5 rounded-full transition-all',
                      readyPct === 100 ? 'bg-green-500' : readyPct >= 50 ? 'bg-amber-500' : 'bg-red-500',
                    )}
                    style={{ width: `${readyPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{readyPct}% ready to close</p>

                {readyCount === totalOutlets && totalOutlets > 0 && (
                  <div className="mt-4 rounded-lg border border-green-200 bg-green-50/70 px-4 py-3 text-sm text-green-800">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-medium">All outlets ready.</span>
                    </div>
                    <p className="mt-1 text-xs">
                      Period close action will be available here in Phase 2 after close state management is implemented in the backend.
                    </p>
                  </div>
                )}
              </div>

              {/* Outlet checklist table */}
              <div className="surface-elevated overflow-hidden">
                <div className="border-b px-5 py-4">
                  <h3 className="text-sm font-semibold">Outlet checklist</h3>
                  <p className="text-xs text-muted-foreground">
                    Payroll and expense status per outlet for {periodLabel}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {['Outlet', 'Payroll runs', 'Expenses', 'Variance reviewed', 'Status'].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium">
                            {h}
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
                          <tr key={row.outletId} className="border-b last:border-0">
                            <td className="px-4 py-3">
                              <div className="flex flex-col">
                                <span className="text-xs font-medium">{row.outletCode}</span>
                                <span className="text-[11px] text-muted-foreground">{row.outletName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {row.payrollTotal === 0 ? (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                  No runs
                                </div>
                              ) : row.payrollApproved ? (
                                <div className="flex items-center gap-1.5 text-xs text-green-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {row.payrollTotal} approved
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-xs text-amber-700">
                                  <XCircle className="h-3.5 w-3.5" />
                                  {row.payrollPending} pending
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
                              <span className="text-xs text-muted-foreground">Phase 2</span>
                            </td>
                            <td className="px-4 py-3">
                              {row.ready ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Ready
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700">
                                  <XCircle className="h-3 w-3" />
                                  Blocked
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

              {/* Blockers panel */}
              {blockers.length > 0 && (
                <div className="surface-elevated px-5 py-4">
                  <h3 className="mb-3 text-sm font-semibold">Blockers to resolve</h3>
                  <div className="space-y-3">
                    {blockers.map((row) => (
                      <div key={row.outletId} className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
                        <p className="text-sm font-medium text-amber-900">
                          {row.outletCode} · {row.outletName}
                        </p>
                        <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
                          {!row.payrollApproved && row.payrollPending > 0 && (
                            <li className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3" />
                              {row.payrollPending} payroll run(s) pending approval
                              <button
                                onClick={() => onNavigate('labor')}
                                className="ml-1 underline hover:no-underline"
                              >
                                → Review payroll
                              </button>
                            </li>
                          )}
                          {row.payrollTotal === 0 && (
                            <li className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3" />
                              No payroll runs exist for this outlet in this period
                            </li>
                          )}
                          {row.hasUncategorizedExpenses && (
                            <li className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3" />
                              {row.uncategorizedCount} expense row(s) need description/review
                              <button
                                onClick={() => onNavigate('expenses')}
                                className="ml-1 underline hover:no-underline"
                              >
                                → View expenses
                              </button>
                            </li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="surface-elevated px-5 py-12 text-center text-sm text-muted-foreground">
              Select a payroll period on the left to view close readiness.
            </div>
          )}

          {/* Close action note */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-3 text-sm text-blue-900">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>
                <p className="font-medium">Period close action — Phase 2</p>
                <p className="mt-1 text-xs text-blue-800">
                  The one-click "Close Period" button with confirmation dialog will be implemented in Phase 2
                  once the backend supports period lock state. Currently this screen provides readiness tracking only.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
