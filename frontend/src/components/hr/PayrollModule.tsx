import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Clock, AlertTriangle, ChevronRight, ChevronDown,
  RefreshCw, Search, TrendingUp, TrendingDown, Wallet, Lock,
  ChevronLeft as ChevronPrev, ChevronRight as ChevronNext,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  authApi,
  payrollApi,
  type AuthScopeView,
  type AuthScopesQuery,
  type PayrollRunView,
  type PayrollTimesheetView,
  type PayrollPeriodView,
  type PayrollPeriodsQuery,
  type PayrollRunsQuery,
  type AuthUserListItem,
  type ScopeOutlet,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { EmptyState } from '@/components/shell/PermissionStates';
import { payrollBadgeClass, formatHrEnumLabel, getHrUserDisplay, shortHrRef } from '@/components/hr/hr-display';
import {
  ExceptionBanner,
  FilterBar,
  KpiCard,
  KpiStrip,
  SegmentChip,
  SegmentChipRow,
  SeverityPill,
  WorkspaceHeader,
} from '@/components/hr/hr-primitives';
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
  scopeOutletId?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PayrollModule({ token, users, outlets, scopeRegionId, scopeOutletId }: PayrollModuleProps) {
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
  const [segment, setSegment] = useState<'all' | 'draft' | 'approved' | 'paid' | 'rejected'>('all');
  const [collapsedOutlets, setCollapsedOutlets] = useState<Set<string>>(new Set());
  // userId → outletIds (set) — derive run's outlet when timesheet outlet_id is null
  const [userOutletMap, setUserOutletMap] = useState<Map<string, Set<string>>>(new Map());

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
        if (allPeriods.length > 0) {
          setSelectedPeriodId((current) => current ?? allPeriods[0].id);
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
      // Don't pass outletId to backend — payroll_timesheet.outlet_id is often NULL,
      // server-side equality filter would exclude those rows. Filter client-side
      // using userOutletMap so we can also include runs where the user belongs to
      // the scoped outlet via user_role assignment.
      const [allRuns, timesheetsPage] = await Promise.all([
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (q) => payrollApi.runs(token, q),
          {
            payrollPeriodId: selectedPeriodId,
            status: runsQuery.filters.status,
            sortBy: runsQuery.sortBy,
            sortDir: runsQuery.sortDir,
          },
          1000,
        ),
        payrollApi.timesheets(token, {
          payrollPeriodId: selectedPeriodId,
          limit: 1000,
          offset: 0,
        }),
      ]);
      setRuns(allRuns);
      setRunsTotal(allRuns.length);
      setRunsHasMore(false);

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
  }, [token, selectedPeriodId, runsQuery.query, runsQuery.filters.status, scopeOutletId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Load user↔outlet map for the current scope so we can derive outlet from userId
  // when payroll_timesheet.outlet_id is null. Region scope → all outlets in region;
  // outlet scope → just that outlet.
  useEffect(() => {
    if (!token) return;
    let active = true;
    void (async () => {
      try {
        const all = await collectPagedItems<AuthScopeView, AuthScopesQuery>(
          (q) => authApi.scopes(token, q),
          { outletId: scopeOutletId || undefined } as AuthScopesQuery,
          500,
        );
        if (!active) return;
        const map = new Map<string, Set<string>>();
        for (const s of all) {
          const uid = String(s.userId);
          const oid = String(s.outletId);
          const existing = map.get(uid);
          if (existing) existing.add(oid);
          else map.set(uid, new Set([oid]));
        }
        setUserOutletMap(map);
      } catch {
        if (active) setUserOutletMap(new Map());
      }
    })();
    return () => { active = false; };
  }, [token, scopeOutletId]);

  // Load comparison period
  useEffect(() => {
    if (!token || !comparePeriodId) { setCompareRuns([]); return; }
    let active = true;
    void (async () => {
      try {
        const allCompare = await collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (q) => payrollApi.runs(token, q),
          { payrollPeriodId: comparePeriodId },
          1000,
        );
        if (active) setCompareRuns(allCompare);
      } catch {
        if (active) setCompareRuns([]);
      }
    })();
    return () => { active = false; };
  }, [token, comparePeriodId, scopeOutletId]);

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

  // Scope filter helper used by KPI + segments + groups + chart.
  const matchesScope = useCallback((r: PayrollRunView): boolean => {
    if (!scopeOutletId) return true;
    if (r.outletId && String(r.outletId) === scopeOutletId) return true;
    const set = r.userId ? userOutletMap.get(String(r.userId)) : undefined;
    return Boolean(set && set.has(scopeOutletId));
  }, [scopeOutletId, userOutletMap]);

  const visibleRuns = useMemo(() => runs.filter(matchesScope), [runs, matchesScope]);
  const visibleCompareRuns = useMemo(() => compareRuns.filter(matchesScope), [compareRuns, matchesScope]);

  // KPI calculations (scope-filtered)
  const totalBase = visibleRuns.reduce((s, r) => s + toNumber(r.baseSalaryAmount), 0);
  const totalNet = visibleRuns.reduce((s, r) => s + toNumber(r.netSalary), 0);
  const draftCount = visibleRuns.filter((r) => String(r.status || '').toLowerCase() === 'draft').length;
  const currency = visibleRuns[0]?.currencyCode || 'USD';

  // Comparison KPIs
  const prevTotalBase = visibleCompareRuns.reduce((s, r) => s + toNumber(r.baseSalaryAmount), 0);
  const prevTotalNet = visibleCompareRuns.reduce((s, r) => s + toNumber(r.netSalary), 0);
  const baseDelta = prevTotalBase > 0 ? ((totalBase - prevTotalBase) / prevTotalBase) * 100 : 0;
  const netDelta = prevTotalNet > 0 ? ((totalNet - prevTotalNet) / prevTotalNet) * 100 : 0;

  // Bar chart data — group net salary by outlet
  const outletsById = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const chartData = useMemo(() => {
    const byOutlet = new Map<string, { name: string; current: number; previous: number }>();
    for (const run of visibleRuns) {
      const oid = deriveRunOutlet(run);
      const outlet = outletsById.get(oid);
      const label = outlet ? (outlet.code || outlet.name || oid) : (oid === 'unassigned' ? 'Unassigned' : oid);
      const entry = byOutlet.get(oid) || { name: label, current: 0, previous: 0 };
      entry.current += toNumber(run.netSalary);
      byOutlet.set(oid, entry);
    }
    for (const run of visibleCompareRuns) {
      const oid = deriveRunOutlet(run);
      const outlet = outletsById.get(oid);
      const label = outlet ? (outlet.code || outlet.name || oid) : (oid === 'unassigned' ? 'Unassigned' : oid);
      const entry = byOutlet.get(oid) || { name: label, current: 0, previous: 0 };
      entry.previous += toNumber(run.netSalary);
      byOutlet.set(oid, entry);
    }
    return Array.from(byOutlet.values()).sort((a, b) => b.current - a.current);
  }, [visibleRuns, visibleCompareRuns, outletsById, deriveRunOutlet]);

  // Derive a run's outlet: prefer payroll_timesheet.outlet_id when present;
  // otherwise fall back to the user's primary user_role outlet. Returns
  // 'unassigned' when no link exists.
  const deriveRunOutlet = useCallback((run: PayrollRunView): string => {
    const explicit = run.outletId ? String(run.outletId) : '';
    if (explicit) return explicit;
    const userId = run.userId ? String(run.userId) : '';
    const set = userId ? userOutletMap.get(userId) : undefined;
    if (!set || set.size === 0) return 'unassigned';
    if (scopeOutletId && set.has(scopeOutletId)) return scopeOutletId;
    // Stable pick: first by sorted id
    return Array.from(set).sort()[0];
  }, [userOutletMap, scopeOutletId]);

  const counts = useMemo(() => {
    let draft = 0;
    let approved = 0;
    let paid = 0;
    let rejected = 0;
    for (const r of visibleRuns) {
      const s = String(r.status || '').toLowerCase();
      if (s === 'draft') draft++;
      else if (s === 'approved') approved++;
      else if (s === 'paid') paid++;
      else if (s === 'rejected') rejected++;
    }
    return { all: visibleRuns.length, draft, approved, paid, rejected };
  }, [visibleRuns]);

  const filteredRuns = useMemo(() => {
    if (segment === 'all') return visibleRuns;
    return visibleRuns.filter((r) => String(r.status || '').toLowerCase() === segment);
  }, [visibleRuns, segment]);

  const runGroups = useMemo(() => {
    const map = new Map<string, PayrollRunView[]>();
    for (const r of filteredRuns) {
      const key = deriveRunOutlet(r);
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    return Array.from(map.entries()).map(([outletId, items]) => {
      const outlet = outletsById.get(outletId);
      const label = outlet ? (outlet.name || outlet.code || outletId) : (outletId === 'unassigned' ? 'Unassigned' : outletId);
      const totalNet = items.reduce((s, r) => s + toNumber(r.netSalary), 0);
      const totalBase = items.reduce((s, r) => s + toNumber(r.baseSalaryAmount), 0);
      const draftCount = items.filter((r) => String(r.status || '').toLowerCase() === 'draft').length;
      return { outletId, label, runs: items, totalNet, totalBase, draftCount };
    });
  }, [filteredRuns, outletsById, deriveRunOutlet]);

  const toggleOutlet = (outletId: string) => {
    setCollapsedOutlets((prev) => {
      const next = new Set(prev);
      if (next.has(outletId)) next.delete(outletId);
      else next.add(outletId);
      return next;
    });
  };

  const periodIndex = selectedPeriodId ? periods.findIndex((p) => p.id === selectedPeriodId) : -1;
  const goPrevPeriod = () => {
    if (periodIndex >= 0 && periodIndex < periods.length - 1) {
      setSelectedPeriodId(periods[periodIndex + 1].id);
    }
  };
  const goNextPeriod = () => {
    if (periodIndex > 0) {
      setSelectedPeriodId(periods[periodIndex - 1].id);
    }
  };

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Payroll & Payslips"
        subtitle={selectedPeriod ? `${selectedPeriod.name || 'Period'} · ${visibleRuns.length} runs` : 'Select a period'}
        actions={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={goPrevPeriod}
              disabled={periodIndex < 0 || periodIndex >= periods.length - 1}
              title="Previous period"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
            >
              <ChevronPrev className="h-3.5 w-3.5" />
            </button>
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
              type="button"
              onClick={goNextPeriod}
              disabled={periodIndex <= 0}
              title="Next period"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
            >
              <ChevronNext className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void loadRuns()}
              disabled={loading}
              className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
              Refresh
            </button>
          </div>
        }
      />

      {draftCount > 0 ? (
        <ExceptionBanner
          tone="warn"
          icon={AlertTriangle}
          message={
            <>
              <span className="font-medium">{draftCount} run{draftCount === 1 ? '' : 's'}</span> awaiting approval.
            </>
          }
          action={
            <button
              type="button"
              onClick={() => setSegment('draft')}
              className="inline-flex h-7 items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              Review
            </button>
          }
        />
      ) : null}

      {/* KPIs */}
      <KpiStrip cols={4}>
        <KpiCard
          icon={Wallet}
          label="Base pay"
          value={fmt(totalBase, currency)}
          sub={`${visibleRuns.length} run${visibleRuns.length === 1 ? '' : 's'}`}
        />
        <KpiCard
          icon={DollarSign}
          label="Net pay"
          value={fmt(totalNet, currency)}
          sub={baseDelta !== 0 && comparePeriodId ? `${netDelta > 0 ? '+' : ''}${netDelta.toFixed(1)}% vs prev` : 'after deductions'}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Net variance"
          value={fmt(totalNet - totalBase, currency)}
          sub="net − base"
        />
        <KpiCard
          icon={Clock}
          label="Pending draft"
          value={draftCount}
          tone={draftCount > 0 ? 'warn' : 'default'}
          sub="awaiting approval"
        />
      </KpiStrip>

      {/* Filter + Segments */}
      <FilterBar>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
            placeholder="Search payroll runs"
            value={runsQuery.searchInput}
            onChange={(e) => runsQuery.setSearchInput(e.target.value)}
          />
        </div>
        {comparePeriodId ? (
          <button
            type="button"
            onClick={() => setShowComparison(!showComparison)}
            className={cn(
              'h-8 rounded-md border px-2.5 text-[11px] transition-colors',
              showComparison ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-accent',
            )}
          >
            {showComparison ? <TrendingDown className="mr-1 inline h-3.5 w-3.5" /> : <TrendingUp className="mr-1 inline h-3.5 w-3.5" />}
            Compare
          </button>
        ) : null}
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={comparePeriodId || ''}
          onChange={(e) => setComparePeriodId(e.target.value || null)}
        >
          <option value="">No comparison</option>
          {periods.filter((p) => p.id !== selectedPeriodId).map((p) => (
            <option key={p.id} value={p.id}>{p.name || `${p.startDate} – ${p.endDate}`}</option>
          ))}
        </select>
      </FilterBar>

      <SegmentChipRow>
        <SegmentChip label="All" count={counts.all} active={segment === 'all'} onClick={() => setSegment('all')} />
        <SegmentChip label="Draft" count={counts.draft} active={segment === 'draft'} tone="warn" onClick={() => setSegment('draft')} />
        <SegmentChip label="Approved" count={counts.approved} active={segment === 'approved'} tone="success" onClick={() => setSegment('approved')} />
        <SegmentChip label="Paid" count={counts.paid} active={segment === 'paid'} tone="success" onClick={() => setSegment('paid')} />
        <SegmentChip label="Rejected" count={counts.rejected} active={segment === 'rejected'} tone="critical" onClick={() => setSegment('rejected')} />
      </SegmentChipRow>

      {/* Chart (collapsible when comparison enabled) */}
      {visibleRuns.length > 0 && showComparison ? (
        <div className="rounded-md border border-border/60 bg-card p-4 space-y-3">
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

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</div>
      ) : null}

      {!selectedPeriodId ? (
        <EmptyState title="No period selected" description="Select a payroll period to view payroll runs." />
      ) : loading && visibleRuns.length === 0 ? (
        <div className="rounded-md border border-border/60 bg-card p-2">
          <ListTableSkeleton columns={4} rows={6} />
        </div>
      ) : runGroups.length === 0 ? (
        <EmptyState title="No payroll runs" description="No runs match this segment for the selected period." />
      ) : (
        <div className="space-y-2">
          {runGroups.map((group) => {
            const collapsed = collapsedOutlets.has(group.outletId);
            const runCurrency = group.runs[0]?.currencyCode || currency;
            return (
              <div key={group.outletId} className="overflow-hidden rounded-md border border-border/60 bg-card">
                <button
                  type="button"
                  onClick={() => toggleOutlet(group.outletId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                >
                  {collapsed
                    ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{group.label}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{group.runs.length} run{group.runs.length === 1 ? '' : 's'}</p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-5 text-right">
                    {group.draftCount > 0 ? (
                      <SeverityPill tone="draft">{group.draftCount} draft</SeverityPill>
                    ) : null}
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Base</p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{fmt(group.totalBase, runCurrency)}</p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Net</p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{fmt(group.totalNet, runCurrency)}</p>
                    </div>
                  </div>
                </button>

                {!collapsed ? (
                  <div className="border-t border-border/60 bg-muted/20">
                    {group.runs.map((run, idx) => {
                      const status = String(run.status || 'unknown').toLowerCase();
                      const userDisplay = getHrUserDisplay(usersById, run.userId);
                      const cur = String(run.currencyCode || 'USD');
                      const locked = status === 'paid' || status === 'locked';
                      return (
                        <button
                          key={String(run.id)}
                          type="button"
                          onClick={() => setSelected(run)}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-accent/40',
                            idx > 0 ? 'border-t border-border/40' : '',
                            locked ? 'opacity-80' : '',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {locked ? <Lock className="h-3 w-3 flex-shrink-0 text-muted-foreground" /> : null}
                              <p className="truncate font-medium text-foreground">{userDisplay.primary}</p>
                            </div>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">
                              {userDisplay.secondary || `#${shortHrRef(run.id)}`}
                              {run.approvedAt ? ` · approved ${formatDate(run.approvedAt)}` : ''}
                            </p>
                          </div>

                          <div className="hidden w-28 flex-shrink-0 text-right sm:block">
                            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Base</p>
                            <p className="font-mono text-[12px] tabular-nums text-foreground">{fmt(run.baseSalaryAmount, cur)}</p>
                          </div>

                          <div className="w-28 flex-shrink-0 text-right">
                            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Net</p>
                            <p className="font-mono text-[12px] font-semibold tabular-nums text-foreground">{fmt(run.netSalary, cur)}</p>
                          </div>

                          <SeverityPill tone={status === 'paid' || status === 'approved' ? 'active' : status === 'draft' ? 'draft' : status === 'rejected' ? 'expired' : 'neutral'}>
                            {formatHrEnumLabel(status)}
                          </SeverityPill>

                          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer total */}
      {selectedPeriodId && visibleRuns.length > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-4 py-2 text-xs">
          <span className="font-mono text-muted-foreground">{visibleRuns.length} run{visibleRuns.length === 1 ? '' : 's'}</span>
          <span className="font-mono font-semibold tabular-nums text-foreground">Total: {fmt(totalNet, currency)}</span>
        </div>
      ) : null}

      {/* Detail drawer */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selected && (() => {
            const userDisplay = getHrUserDisplay(usersById, selected.userId);
            const ts = selected.userId ? timesheetsByUser.get(selected.userId) : null;
            const cur = String(selected.currencyCode || 'USD');
            const baseNum = toNumber(selected.baseSalaryAmount);
            const netNum = toNumber(selected.netSalary);
            // OT pay estimate from timesheet (monthly: hourlyRate = base / 160; hourly/daily: base already includes work)
            const otHours = ts ? toNumber(ts.overtimeHours) : 0;
            const otRate = ts ? toNumber(ts.overtimeRate) || 1 : 1;
            const otPay = otHours > 0 ? (baseNum / 160) * otHours * otRate : 0;
            const grossEstimate = baseNum + otPay;
            const deductions = Math.max(0, grossEstimate - netNum);
            // Heuristic: deductions present → likely full_time with statutory withholding
            const hasDeductions = deductions > 0.5;
            const social = hasDeductions ? grossEstimate * 0.08 : 0;
            const health = hasDeductions ? grossEstimate * 0.015 : 0;
            const unemployment = hasDeductions ? grossEstimate * 0.01 : 0;
            const pit = hasDeductions ? Math.max(0, deductions - social - health - unemployment) : 0;
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
                  <div className="rounded-md border border-border/60 bg-card p-4 space-y-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Earnings</span>
                    <div className="flex justify-between py-1.5">
                      <span className="text-sm text-muted-foreground">Base pay</span>
                      <span className="font-mono text-sm tabular-nums">{fmt(baseNum, cur)}</span>
                    </div>
                    {otHours > 0 ? (
                      <div className="flex justify-between py-1.5">
                        <span className="text-sm text-muted-foreground">Overtime pay</span>
                        <span className="font-mono text-sm tabular-nums">{fmt(otPay, cur)}</span>
                      </div>
                    ) : null}
                    <div className="mt-1 flex justify-between border-t border-border/40 pt-2">
                      <span className="text-sm font-medium text-foreground">Gross</span>
                      <span className="font-mono text-sm font-semibold tabular-nums">{fmt(grossEstimate, cur)}</span>
                    </div>
                    {ts ? (
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/40 pt-3">
                        <div className="flex justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Days</span>
                          <span className="font-mono text-[11px] tabular-nums">{toNumber(ts.workDays)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Hours</span>
                          <span className="font-mono text-[11px] tabular-nums">{toNumber(ts.workHours).toFixed(1)}h</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">OT hours</span>
                          <span className="font-mono text-[11px] tabular-nums">{toNumber(ts.overtimeHours).toFixed(1)}h × {otRate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Late</span>
                          <span className="font-mono text-[11px] tabular-nums">{toNumber(ts.lateCount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Absent</span>
                          <span className="font-mono text-[11px] tabular-nums">{toNumber(ts.absentDays)}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Statutory deductions (full_time only) */}
                  {hasDeductions ? (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">Statutory deductions</span>
                        <span className="font-mono text-[10px] text-muted-foreground">VN full-time</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-xs text-muted-foreground" title="Bảo hiểm xã hội">Social insurance · BHXH 8%</span>
                        <span className="font-mono text-xs tabular-nums text-destructive">−{fmt(social, cur)}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-xs text-muted-foreground" title="Bảo hiểm y tế">Health insurance · BHYT 1.5%</span>
                        <span className="font-mono text-xs tabular-nums text-destructive">−{fmt(health, cur)}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-xs text-muted-foreground" title="Bảo hiểm thất nghiệp">Unemployment · BHTN 1%</span>
                        <span className="font-mono text-xs tabular-nums text-destructive">−{fmt(unemployment, cur)}</span>
                      </div>
                      {pit > 0.5 ? (
                        <div className="flex justify-between py-1">
                          <span className="text-xs text-muted-foreground" title="Thuế thu nhập cá nhân">Personal income tax · TNCN</span>
                          <span className="font-mono text-xs tabular-nums text-destructive">−{fmt(pit, cur)}</span>
                        </div>
                      ) : null}
                      <div className="mt-1 flex justify-between border-t border-amber-500/20 pt-2">
                        <span className="text-xs font-medium text-foreground">Total deductions</span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-destructive">−{fmt(deductions, cur)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                      No statutory deductions · part-time / seasonal / contractor exempt from BHXH/BHYT/BHTN/TNCN.
                    </div>
                  )}

                  {/* Net Pay highlight */}
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-5 border-l-4 border-l-primary">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-foreground">Net pay</span>
                      <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{fmt(netNum, cur)}</span>
                    </div>
                    {hasDeductions ? (
                      <p className="mt-1 text-right font-mono text-[10px] text-muted-foreground">
                        gross {fmt(grossEstimate, cur)} − {fmt(deductions, cur)} statutory
                      </p>
                    ) : null}
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
