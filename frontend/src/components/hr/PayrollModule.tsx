import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Users, Clock, AlertTriangle, ChevronRight, Download,
  RefreshCw, Search, TrendingUp, TrendingDown, ArrowRight,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  payrollApi,
  type PayrollRunView,
  type PayrollTimesheetView,
  type PayrollPeriodView,
  type PayrollPeriodsQuery,
  type AuthUserListItem,
  type ScopeOutlet,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { EmptyState } from '@/components/shell/PermissionStates';
import { payrollBadgeClass, formatHrEnumLabel, getHrUserDisplay, shortHrRef } from '@/components/hr/hr-display';
import { collectPagedItems } from '@/lib/collect-paged-items';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface PayrollModuleProps {
  token: string;
  users: AuthUserListItem[];
  outlets: ScopeOutlet[];
  scopeRegionId?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PayrollModule({ token, users, outlets, scopeRegionId }: PayrollModuleProps) {
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsHasMore, setRunsHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<PayrollRunView | null>(null);
  const [timesheetsByUser, setTimesheetsByUser] = useState<Map<string, PayrollTimesheetView>>(new Map());
  const [comparePeriodId, setComparePeriodId] = useState<string | null>(null);
  const [compareRuns, setCompareRuns] = useState<PayrollRunView[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const runsQuery = useListQueryState<{ status?: string }>({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: { status: undefined },
  });

  // Load periods
  useEffect(() => {
    if (!token) return;
    let active = true;
    void (async () => {
      try {
        const allPeriods = await collectPagedItems<PayrollPeriodView, PayrollPeriodsQuery>(
          (q) => payrollApi.periods(token, q),
          { regionId: scopeRegionId, sortBy: 'startDate', sortDir: 'desc' },
          100,
        );
        if (!active) return;
        setPeriods(allPeriods);
        if (allPeriods.length > 0 && !selectedPeriodId) {
          setSelectedPeriodId(allPeriods[0].id);
        }
      } catch (err) {
        console.error('Failed to load payroll periods', err);
      }
    })();
    return () => { active = false; };
  }, [token, scopeRegionId]);

  // Load runs for selected period
  const loadRuns = useCallback(async () => {
    if (!token || !selectedPeriodId) return;
    setLoading(true);
    setError('');
    try {
      const [runsPage, timesheetsPage] = await Promise.all([
        payrollApi.runs(token, {
          payrollPeriodId: selectedPeriodId,
          ...runsQuery.query,
          status: runsQuery.filters.status,
        }),
        payrollApi.timesheets(token, { payrollPeriodId: selectedPeriodId, limit: 200, offset: 0 }),
      ]);
      setRuns(runsPage.items || []);
      setRunsTotal(runsPage.total || runsPage.totalCount || 0);
      setRunsHasMore(runsPage.hasMore || runsPage.hasNextPage || false);

      const tsMap = new Map<string, PayrollTimesheetView>();
      for (const ts of (timesheetsPage.items || [])) {
        if (ts.userId) tsMap.set(ts.userId, ts);
      }
      setTimesheetsByUser(tsMap);
    } catch (err: unknown) {
      console.error('Failed to load payroll runs', err);
      setRuns([]);
      setRunsTotal(0);
      setError(getErrorMessage(err, 'Unable to load payroll data'));
    } finally {
      setLoading(false);
    }
  }, [token, selectedPeriodId, runsQuery.query, runsQuery.filters.status]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Load comparison period
  useEffect(() => {
    if (!token || !comparePeriodId) { setCompareRuns([]); return; }
    let active = true;
    void (async () => {
      try {
        const page = await payrollApi.runs(token, { payrollPeriodId: comparePeriodId, limit: 200, offset: 0 });
        if (active) setCompareRuns(page.items || []);
      } catch {
        if (active) setCompareRuns([]);
      }
    })();
    return () => { active = false; };
  }, [token, comparePeriodId]);

  // Auto-select previous period for comparison
  useEffect(() => {
    if (!selectedPeriodId || periods.length < 2) return;
    const idx = periods.findIndex((p) => p.id === selectedPeriodId);
    if (idx >= 0 && idx < periods.length - 1) {
      setComparePeriodId(periods[idx + 1].id);
    }
  }, [selectedPeriodId, periods]);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const comparePeriod = periods.find((p) => p.id === comparePeriodId);

  // KPI calculations
  const totalBase = runs.reduce((s, r) => s + toNumber(r.baseSalaryAmount), 0);
  const totalNet = runs.reduce((s, r) => s + toNumber(r.netSalary), 0);
  const draftCount = runs.filter((r) => String(r.status || '').toLowerCase() === 'draft').length;
  const currency = runs[0]?.currencyCode || 'USD';

  // Comparison KPIs
  const prevTotalBase = compareRuns.reduce((s, r) => s + toNumber(r.baseSalaryAmount), 0);
  const prevTotalNet = compareRuns.reduce((s, r) => s + toNumber(r.netSalary), 0);
  const baseDelta = prevTotalBase > 0 ? ((totalBase - prevTotalBase) / prevTotalBase) * 100 : 0;
  const netDelta = prevTotalNet > 0 ? ((totalNet - prevTotalNet) / prevTotalNet) * 100 : 0;

  // Bar chart data — group net salary by outlet
  const outletsById = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const chartData = useMemo(() => {
    const byOutlet = new Map<string, { name: string; current: number; previous: number }>();
    for (const run of runs) {
      const oid = String(run.outletId || 'unassigned');
      const outlet = outletsById.get(oid);
      const label = outlet ? (outlet.code || outlet.name || oid) : (oid === 'unassigned' ? 'Unassigned' : oid);
      const entry = byOutlet.get(oid) || { name: label, current: 0, previous: 0 };
      entry.current += toNumber(run.netSalary);
      byOutlet.set(oid, entry);
    }
    for (const run of compareRuns) {
      const oid = String(run.outletId || 'unassigned');
      const outlet = outletsById.get(oid);
      const label = outlet ? (outlet.code || outlet.name || oid) : (oid === 'unassigned' ? 'Unassigned' : oid);
      const entry = byOutlet.get(oid) || { name: label, current: 0, previous: 0 };
      entry.previous += toNumber(run.netSalary);
      byOutlet.set(oid, entry);
    }
    return Array.from(byOutlet.values()).sort((a, b) => b.current - a.current);
  }, [runs, compareRuns, outletsById]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Payroll & Payslips</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {selectedPeriod ? `${selectedPeriod.name || 'Payroll period'} — ${runs.length} payroll runs` : 'Select a payroll period'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-3 text-xs"
            value={selectedPeriodId || ''}
            onChange={(e) => setSelectedPeriodId(e.target.value || null)}
          >
            <option value="">— Select period —</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || `${p.startDate} – ${p.endDate}`}
              </option>
            ))}
          </select>
          <button
            onClick={() => void loadRuns()}
            disabled={loading}
            className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} /> Refresh
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          { label: 'Total Base', value: fmt(totalBase, currency), icon: DollarSign, sub: `${runs.length} employees`, delta: baseDelta },
          { label: 'Total Net Pay', value: fmt(totalNet, currency), icon: DollarSign, sub: 'After deductions', delta: netDelta },
          { label: 'Difference', value: fmt(totalBase - totalNet, currency), icon: AlertTriangle, sub: 'Base - Net', delta: 0 },
          { label: 'Pending Draft', value: draftCount.toString(), icon: Clock, sub: 'Awaiting approval', delta: 0 },
        ]).map((k) => (
          <div key={k.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <k.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</span>
            </div>
            <p className="text-xl font-semibold text-foreground">{k.value}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <p className="text-[10px] text-muted-foreground">{k.sub}</p>
              {k.delta !== 0 && comparePeriodId ? (
                <span className={cn('text-[10px] font-medium flex items-center gap-0.5', k.delta > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                  {k.delta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                  {Math.abs(k.delta).toFixed(1)}%
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Chart + Comparison toggle */}
      {runs.length > 0 ? (
        <div className="surface-elevated p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Net Pay by Outlet</span>
              {comparePeriod && showComparison ? (
                <span className="text-[10px] text-muted-foreground">
                  vs {comparePeriod.name || 'Previous period'}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {comparePeriodId ? (
                <button
                  onClick={() => setShowComparison(!showComparison)}
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                    showComparison ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  Compare
                </button>
              ) : null}
              <select
                className="h-7 rounded border border-input bg-background px-2 text-[10px]"
                value={comparePeriodId || ''}
                onChange={(e) => setComparePeriodId(e.target.value || null)}
              >
                <option value="">No comparison</option>
                {periods.filter((p) => p.id !== selectedPeriodId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name || `${p.startDate} – ${p.endDate}`}</option>
                ))}
              </select>
            </div>
          </div>
          {chartData.length > 0 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={2}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmt(v, currency)} width={80} />
                  <Tooltip
                    formatter={(value: number) => fmt(value, currency)}
                    labelStyle={{ fontSize: 11 }}
                    contentStyle={{ fontSize: 11, borderRadius: 6 }}
                  />
                  <Bar dataKey="current" name={selectedPeriod?.name || 'Current'} fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  {showComparison && comparePeriodId ? (
                    <Bar dataKey="previous" name={comparePeriod?.name || 'Previous'} fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} opacity={0.5} />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {!selectedPeriodId ? (
        <EmptyState title="No period selected" description="Select a payroll period to view payroll runs." />
      ) : runs.length === 0 && !loading ? (
        <EmptyState title="No payroll runs" description="No payroll runs found for this period." />
      ) : (
        <div className="surface-elevated overflow-x-auto">
          <div className="flex items-center justify-between p-3 border-b">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  className="h-8 w-56 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                  placeholder="Search payroll runs"
                  value={runsQuery.searchInput}
                  onChange={(e) => runsQuery.setSearchInput(e.target.value)}
                />
              </div>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={runsQuery.filters.status || 'all'}
                onChange={(e) => runsQuery.setFilter('status', e.target.value === 'all' ? undefined : e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="border-b bg-card">
                {['Employee', 'Base Salary', 'Net Pay', 'Currency', 'Status', 'Approved At', ''].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      'text-xs font-medium text-muted-foreground px-3 py-2.5',
                      ['Base Salary', 'Net Pay'].includes(h) ? 'text-right' : 'text-left',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && runs.length === 0 ? (
                <ListTableSkeleton columns={7} rows={6} />
              ) : (
                runs.map((run) => {
                  const status = String(run.status || 'unknown').toLowerCase();
                  const userDisplay = getHrUserDisplay(usersById, run.userId);
                  return (
                    <tr
                      key={String(run.id)}
                      className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => setSelected(run)}
                    >
                      <td className="px-3 py-2.5">
                        <p className="text-sm font-medium text-foreground">{userDisplay.primary}</p>
                        <p className="text-[10px] text-muted-foreground">{userDisplay.secondary || shortHrRef(run.id)}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm">{fmt(run.baseSalaryAmount, String(run.currencyCode || 'USD'))}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm font-semibold">{fmt(run.netSalary, String(run.currencyCode || 'USD'))}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{String(run.currencyCode || '—').toUpperCase()}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', payrollBadgeClass(status))}>
                          {formatHrEnumLabel(status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{run.approvedAt ? <span className="text-muted-foreground">{formatDate(run.approvedAt)}</span> : <span className="text-muted-foreground/50 italic text-[10px]">Pending</span>}</td>
                      <td className="px-3 py-2.5"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
          <div className="p-3">
            <ListPaginationControls
              total={runsTotal}
              limit={runsQuery.limit}
              offset={runsQuery.offset}
              hasMore={runsHasMore}
              disabled={loading}
              onPageChange={runsQuery.setPage}
              onLimitChange={runsQuery.setPageSize}
            />
          </div>
        </div>
      )}

      {/* Detail drawer */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selected && (() => {
            const userDisplay = getHrUserDisplay(usersById, selected.userId);
            const ts = selected.userId ? timesheetsByUser.get(selected.userId) : null;
            const cur = String(selected.currencyCode || 'USD');
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="text-lg">{userDisplay.primary}</SheetTitle>
                  <SheetDescription>
                    {shortHrRef(selected.id)} · {selectedPeriod?.name || 'Payroll run'}
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-6 space-y-5">
                  {/* Earnings */}
                  <div className="surface-elevated p-4 space-y-2">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Earnings</span>
                    <div className="flex justify-between py-1.5">
                      <span className="text-sm text-muted-foreground">Base Salary</span>
                      <span className="text-sm font-mono">{fmt(selected.baseSalaryAmount, cur)}</span>
                    </div>
                    {ts ? (
                      <>
                        <div className="flex justify-between py-1.5">
                          <span className="text-sm text-muted-foreground">Work Days</span>
                          <span className="text-sm font-mono">{toNumber(ts.workDays)}</span>
                        </div>
                        <div className="flex justify-between py-1.5">
                          <span className="text-sm text-muted-foreground">Work Hours</span>
                          <span className="text-sm font-mono">{toNumber(ts.workHours).toFixed(1)}h</span>
                        </div>
                        <div className="flex justify-between py-1.5">
                          <span className="text-sm text-muted-foreground">Overtime Hours</span>
                          <span className="text-sm font-mono">{toNumber(ts.overtimeHours).toFixed(1)}h x{toNumber(ts.overtimeRate)}</span>
                        </div>
                        <div className="flex justify-between py-1.5">
                          <span className="text-sm text-muted-foreground">Late Count</span>
                          <span className="text-sm font-mono">{toNumber(ts.lateCount)}</span>
                        </div>
                        <div className="flex justify-between py-1.5">
                          <span className="text-sm text-muted-foreground">Absent Days</span>
                          <span className="text-sm font-mono">{toNumber(ts.absentDays)}</span>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {/* Net Pay highlight */}
                  <div className="surface-elevated p-5 border-l-4 border-l-primary">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-foreground">Net Pay</span>
                      <span className="text-2xl font-bold text-foreground">{fmt(selected.netSalary, cur)}</span>
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="surface-elevated p-4 space-y-2">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Details</span>
                    <div className="flex justify-between py-1.5">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', payrollBadgeClass(selected.status))}>
                        {formatHrEnumLabel(selected.status)}
                      </span>
                    </div>
                    {selected.approvedAt ? (
                      <div className="flex justify-between py-1.5">
                        <span className="text-sm text-muted-foreground">Approved At</span>
                        <span className="text-sm">{formatDate(selected.approvedAt)}</span>
                      </div>
                    ) : null}
                    {selected.paymentRef ? (
                      <div className="flex justify-between py-1.5">
                        <span className="text-sm text-muted-foreground">Payment Ref</span>
                        <span className="text-sm font-mono">{selected.paymentRef}</span>
                      </div>
                    ) : null}
                    {selected.note ? (
                      <div className="flex justify-between py-1.5">
                        <span className="text-sm text-muted-foreground">Note</span>
                        <span className="text-sm">{selected.note}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
