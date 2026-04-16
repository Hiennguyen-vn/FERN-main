import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  hrApi,
  payrollApi,
  type OutletStaffView,
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
import { EmptyState } from '@/components/shell/PermissionStates';
import { getFinanceOutletDisplay } from '@/components/finance/finance-display';
import { payrollBadgeClass, shortHrRef } from '@/components/hr/hr-display';
import { collectPagedItems } from '@/lib/collect-paged-items';
import {
  inferPeriodWindowState,
  periodWindowBadgeClass,
  periodWindowLabel,
} from '@/components/payroll/payroll-truth';
import { cn } from '@/lib/utils';
import {
  toNum,
  formatMoneyExact,
  formatDateShort,
  formatDateTime as formatDateTimeUtil,
  formatMonthYear,
} from '@/components/finance/finance-utils';

interface FinancePayrollReviewWorkspaceProps {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}

function formatDate(value?: string | null) {
  return formatDateShort(value);
}

function formatDateRange(startDate?: string | null, endDate?: string | null) {
  if (!startDate && !endDate) {
    return 'Window unavailable';
  }
  return `${formatDate(startDate)} → ${formatDate(endDate)}`;
}

function formatMonthYearOrFallback(value?: string | null) {
  const result = formatMonthYear(value);
  return result === '—' ? 'Payroll review' : result;
}

function normalizeValue(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

function buildPeriodHeadline(period: PayrollPeriodView | null, regionName: string) {
  const explicitName = normalizeValue(period?.name);
  if (explicitName) {
    return explicitName;
  }
  return `${formatMonthYearOrFallback(period?.startDate || period?.endDate || period?.payDate)} · ${regionName}`;
}

function getRegionName(regionsById: Map<string, ScopeRegion>, regionId?: string | number | null) {
  const key = normalizeValue(regionId);
  if (!key) {
    return 'Selected region';
  }
  return regionsById.get(key)?.name || `Region ${key}`;
}

function getUserDisplay(
  staffById: Map<string, OutletStaffView>,
  userId?: string | number | null,
) {
  const key = normalizeValue(userId);
  if (!key) {
    return { primary: '—', secondary: undefined as string | undefined };
  }

  const staff = staffById.get(key);
  if (staff) {
    return {
      primary: staff.fullName || staff.username || `Employee ${key}`,
      secondary: staff.employeeCode || staff.username || undefined,
    };
  }

  return { primary: `Employee ${key}`, secondary: undefined as string | undefined };
}

export function FinancePayrollReviewWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
}: FinancePayrollReviewWorkspaceProps) {
  const [staffLoading, setStaffLoading] = useState(false);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState('');
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [staff, setStaff] = useState<OutletStaffView[]>([]);
  const [search, setSearch] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [rejectingRunId, setRejectingRunId] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const regionsById = useMemo(
    () => new Map(regions.map((region) => [region.id, region])),
    [regions],
  );
  const staffById = useMemo(
    () => new Map(staff.map((s) => [String(s.id), s])),
    [staff],
  );
  const outletsById = useMemo(
    () => new Map(outlets.map((outlet) => [outlet.id, outlet])),
    [outlets],
  );

  const scopedRegionId = useMemo(() => {
    if (scopeRegionId) {
      return scopeRegionId;
    }
    if (!scopeOutletId) {
      return '';
    }
    return outlets.find((outlet) => outlet.id === scopeOutletId)?.regionId || '';
  }, [outlets, scopeOutletId, scopeRegionId]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const selectedRegionName = useMemo(
    () => getRegionName(regionsById, selectedPeriod?.regionId || scopedRegionId),
    [regionsById, scopedRegionId, selectedPeriod?.regionId],
  );

  const selectedPeriodHeadline = useMemo(
    () => buildPeriodHeadline(selectedPeriod, selectedRegionName),
    [selectedPeriod, selectedRegionName],
  );

  const runByTimesheetId = useMemo(
    () =>
      new Map(
        runs
          .filter((run) => normalizeValue(run.payrollTimesheetId))
          .map((run) => [String(run.payrollTimesheetId), run]),
      ),
    [runs],
  );

  const reviewRows = useMemo(() => {
    return timesheets.map((timesheet) => {
      const userDisplay = getUserDisplay(staffById, timesheet.userId);
      const outletDisplay = getFinanceOutletDisplay(outletsById, timesheet.outletId);
      const run = runByTimesheetId.get(String(timesheet.id));
      const status = normalizeValue(run?.status).toLowerCase();
      return {
        id: String(timesheet.id),
        employeePrimary: userDisplay.primary,
        employeeSecondary: userDisplay.secondary,
        outletPrimary: outletDisplay.primary,
        outletSecondary: outletDisplay.secondary,
        workHours: toNum(timesheet.workHours),
        overtimeHours: toNum(timesheet.overtimeHours),
        lateCount: toNum(timesheet.lateCount),
        absentDays: toNum(timesheet.absentDays),
        run,
        runStatus: status,
      };
    });
  }, [outletsById, runByTimesheetId, timesheets, staffById]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reviewRows
      .filter((row) => {
        if (!query) {
          return true;
        }
        return [
          row.employeePrimary,
          row.employeeSecondary,
          row.outletPrimary,
          row.outletSecondary,
          row.run?.id,
          row.run?.status,
        ].some((value) => String(value ?? '').toLowerCase().includes(query));
      })
      .sort((left, right) => left.employeePrimary.localeCompare(right.employeePrimary));
  }, [reviewRows, search]);

  const summary = useMemo(() => {
    const draftRuns = reviewRows.filter((row) => row.runStatus === 'draft').length;
    const approvedRuns = reviewRows.filter((row) => row.runStatus === 'approved').length;
    const waitingOnHr = reviewRows.filter((row) => !row.run).length;
    return {
      draftRuns,
      approvedRuns,
      waitingOnHr,
      overtimeHours: reviewRows.reduce((sum, row) => sum + row.overtimeHours, 0),
    };
  }, [reviewRows]);

  const scopedOutlets = useMemo(() => {
    if (scopeOutletId) return outlets.filter((o) => o.id === scopeOutletId);
    if (scopeRegionId) return outlets.filter((o) => o.regionId === scopeRegionId);
    return outlets;
  }, [outlets, scopeOutletId, scopeRegionId]);

  const loadStaff = useCallback(async () => {
    if (!token || scopedOutlets.length === 0) return;
    setStaffLoading(true);
    try {
      // Fetch staff from all scoped outlets in parallel, deduplicate by id
      const results = await Promise.all(
        scopedOutlets.map((o) => hrApi.outletStaff(token, o.id).catch(() => [] as OutletStaffView[])),
      );
      const seen = new Set<string>();
      const merged: OutletStaffView[] = [];
      for (const batch of results) {
        for (const s of batch) {
          const key = String(s.id);
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(s);
          }
        }
      }
      setStaff(merged);
    } catch (error) {
      console.error('Finance payroll review staff load failed', error);
    } finally {
      setStaffLoading(false);
    }
  }, [token, scopedOutlets]);

  const loadPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    setPeriodsError('');
    try {
      const items = await collectPagedItems<PayrollPeriodView, PayrollPeriodsQuery>(
        (query) => payrollApi.periods(token, query),
        {
          regionId: scopedRegionId || undefined,
          sortBy: 'startDate',
          sortDir: 'desc',
        },
      );
      setPeriods(items);
      setSelectedPeriodId((current) => {
        if (current && items.some((period) => period.id === current)) {
          return current;
        }
        return items[0]?.id || '';
      });
    } catch (error: unknown) {
      console.error('Finance payroll review period load failed', error);
      setPeriods([]);
      setSelectedPeriodId('');
      setPeriodsError(getErrorMessage(error, 'Unable to load payroll periods'));
    } finally {
      setPeriodsLoading(false);
    }
  }, [scopedRegionId, token]);

  const loadWorkspace = useCallback(async () => {
    if (!selectedPeriodId) {
      setTimesheets([]);
      setRuns([]);
      setWorkspaceError('');
      return;
    }

    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const [timesheetItems, runItems] = await Promise.all([
        collectPagedItems<PayrollTimesheetView, PayrollTimesheetsQuery>(
          (query) => payrollApi.timesheets(token, query),
          {
            payrollPeriodId: selectedPeriodId,
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
        ),
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (query) => payrollApi.runs(token, query),
          {
            payrollPeriodId: selectedPeriodId,
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
        ),
      ]);
      setTimesheets(timesheetItems);
      setRuns(runItems);
    } catch (error: unknown) {
      console.error('Finance payroll review workspace load failed', error);
      setTimesheets([]);
      setRuns([]);
      setWorkspaceError(getErrorMessage(error, 'Unable to load payroll review workspace'));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [scopeOutletId, selectedPeriodId, token]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const approveRun = async (payrollId: string) => {
    setBusyKey(`approve:${payrollId}`);
    try {
      await payrollApi.approveRun(token, payrollId);
      toast.success('Payroll run approved. The expense entry will appear in the ledger shortly.');
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to approve payroll run'));
    } finally {
      setBusyKey('');
    }
  };

  const rejectRun = async (payrollId: string) => {
    if (!rejectReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    setBusyKey(`reject:${payrollId}`);
    try {
      await payrollApi.rejectRun(token, payrollId, { reason: rejectReason.trim() });
      toast.success('Payroll run rejected.');
      setRejectingRunId('');
      setRejectReason('');
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to reject payroll run'));
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="surface-elevated overflow-hidden">
        <div className="border-b px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>Payroll windows</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold">Finance review</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and approve payroll runs submitted by HR for {selectedRegionName}.
          </p>
        </div>

        {periodsError ? <p className="border-b px-5 py-3 text-xs text-destructive">{periodsError}</p> : null}

        <div className="border-b px-5 py-3">
          <button
            onClick={() => {
              void loadStaff();
              void loadPeriods();
              void loadWorkspace();
            }}
            disabled={staffLoading || periodsLoading || workspaceLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', staffLoading || periodsLoading || workspaceLoading ? 'animate-spin' : '')} />
            Refresh review
          </button>
        </div>

        {periodsLoading && periods.length === 0 ? (
          <div className="px-5 py-10 text-sm text-muted-foreground">Loading payroll windows…</div>
        ) : periods.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              title="No payroll windows in scope"
              description="HR needs to create a payroll period before Finance can review draft runs."
            />
          </div>
        ) : (
          <div className="max-h-[calc(100vh-20rem)] overflow-y-auto">
            {periods.map((period) => {
              const state = inferPeriodWindowState(period);
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
                        {buildPeriodHeadline(period, getRegionName(regionsById, period.regionId))}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDateRange(period.startDate, period.endDate)}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Pay date {formatDate(period.payDate)}</p>
                    </div>
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', periodWindowBadgeClass(state))}>
                      {periodWindowLabel(state)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      <section className="space-y-5">
        {selectedPeriod ? (
          <>
            <div className="surface-elevated overflow-hidden">
              <div className="border-b px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold">{selectedPeriodHeadline}</h3>
                    <p className="text-xs text-muted-foreground">
                      {selectedRegionName} · {formatDateRange(selectedPeriod.startDate, selectedPeriod.endDate)}
                    </p>
                  </div>
                  <span className={cn('inline-flex w-fit rounded-full border px-2.5 py-1 text-[11px] font-medium', periodWindowBadgeClass(inferPeriodWindowState(selectedPeriod)))}>
                    {periodWindowLabel(inferPeriodWindowState(selectedPeriod))}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className={cn('rounded-lg border px-3 py-2', summary.draftRuns > 0 ? 'border-amber-200 bg-amber-50' : 'border-border bg-muted/30')}>
                    <p className={cn('text-xl font-semibold', summary.draftRuns > 0 ? 'text-amber-700' : 'text-foreground')}>{summary.draftRuns}</p>
                    <p className="text-[11px] text-muted-foreground">Pending approval</p>
                  </div>
                  <div className={cn('rounded-lg border px-3 py-2', summary.approvedRuns > 0 ? 'border-green-200 bg-green-50' : 'border-border bg-muted/30')}>
                    <p className={cn('text-xl font-semibold', summary.approvedRuns > 0 ? 'text-green-700' : 'text-foreground')}>{summary.approvedRuns}</p>
                    <p className="text-[11px] text-muted-foreground">Approved</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <p className="text-xl font-semibold">{summary.waitingOnHr}</p>
                    <p className="text-[11px] text-muted-foreground">Waiting on HR</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <p className="text-xl font-semibold">{summary.overtimeHours.toFixed(1)}</p>
                    <p className="text-[11px] text-muted-foreground">OT hours</p>
                  </div>
                </div>
                {summary.draftRuns === 0 && summary.approvedRuns > 0 && summary.waitingOnHr === 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50/70 px-3 py-2 text-xs text-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    All payroll runs for this period have been approved. The ledger has been updated.
                  </div>
                )}
                {summary.draftRuns > 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    {summary.draftRuns} run{summary.draftRuns > 1 ? 's' : ''} pending your approval. Review salary figures before approving.
                  </div>
                )}
              </div>

              <div className="border-b px-5 py-4">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search employee, outlet, run"
                    className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                  />
                </div>
              </div>

              {workspaceError ? <p className="border-b px-5 py-3 text-xs text-destructive">{workspaceError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Employee', 'Outlet', 'Labor input', 'Run state', 'Net salary', 'Action'].map((header) => (
                        <th key={header} className={cn('px-4 py-2.5 text-[11px]', header === 'Net salary' ? 'text-right' : 'text-left')}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {workspaceLoading && rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                          Loading review queue…
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                          No payroll records found for this period.
                        </td>
                      </tr>
                    ) : rows.map((row) => {
                      const runStatus = row.runStatus || 'unprepared';
                      const canApprove = runStatus === 'draft' && row.run;
                      return (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{row.employeePrimary}</span>
                              {row.employeeSecondary ? (
                                <span className="text-[11px] text-muted-foreground">{row.employeeSecondary}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{row.outletPrimary}</span>
                              {row.outletSecondary ? (
                                <span className="text-[11px] text-muted-foreground">{row.outletSecondary}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col text-xs text-muted-foreground">
                              <span>{row.workHours.toFixed(2)} hrs worked</span>
                              <span>{row.overtimeHours.toFixed(2)} OT · {row.lateCount} late · {row.absentDays.toFixed(2)} absent</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            {row.run ? (
                              <div className="flex flex-col gap-1">
                                <span className={cn('inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', payrollBadgeClass(runStatus))}>
                                  {runStatus}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {shortHrRef(row.run.id)} · {row.run.approvedAt ? formatDateTimeUtil(row.run.approvedAt) : 'Awaiting finance approval'}
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col text-xs text-muted-foreground">
                                <span>No draft run yet</span>
                                <span>Prepared in HR before Finance can approve.</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">
                            {row.run
                              ? formatMoneyExact(row.run.netSalary, String(row.run.currencyCode || 'USD'))
                              : '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            {!row.run ? (
                              <span className="text-xs text-muted-foreground">Waiting on HR</span>
                            ) : canApprove ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => void approveRun(String(row.run?.id))}
                                    disabled={!!busyKey}
                                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2.5 text-[11px] font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-60"
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                    {busyKey === `approve:${row.run?.id}` ? 'Approving…' : 'Approve'}
                                  </button>
                                  {rejectingRunId === String(row.run?.id) ? (
                                    <button
                                      onClick={() => { setRejectingRunId(''); setRejectReason(''); }}
                                      className="inline-flex h-7 items-center px-2 text-[11px] text-muted-foreground hover:text-foreground"
                                    >
                                      Cancel
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => setRejectingRunId(String(row.run?.id))}
                                      disabled={!!busyKey}
                                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
                                    >
                                      Reject
                                    </button>
                                  )}
                                </div>
                                {rejectingRunId === String(row.run?.id) && (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      placeholder="Reason for rejection"
                                      value={rejectReason}
                                      onChange={(e) => setRejectReason(e.target.value)}
                                      className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                                      onKeyDown={(e) => { if (e.key === 'Enter') void rejectRun(String(row.run?.id)); }}
                                    />
                                    <button
                                      onClick={() => void rejectRun(String(row.run?.id))}
                                      disabled={busyKey === `reject:${row.run?.id}` || !rejectReason.trim()}
                                      className="inline-flex h-7 items-center rounded-md bg-red-600 px-2.5 text-[11px] font-medium text-white disabled:opacity-60"
                                    >
                                      {busyKey === `reject:${row.run?.id}` ? 'Rejecting…' : 'Confirm'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : row.runStatus === 'approved' ? (
                              <div className="flex items-center gap-1.5 text-xs text-green-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Approved
                                {row.run.approvedAt && (
                                  <span className="text-muted-foreground">{formatDateTimeUtil(row.run.approvedAt)}</span>
                                )}
                              </div>
                            ) : row.runStatus === 'rejected' ? (
                              <div className="flex items-center gap-1.5 text-xs text-red-700">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Rejected
                              </div>
                            ) : row.runStatus === 'paid' ? (
                              <div className="flex items-center gap-1.5 text-xs text-blue-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Paid
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground capitalize">{row.runStatus || '—'}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-5 py-4 text-sm text-blue-900">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-4 w-4 text-blue-700" />
                <div>
                  <p className="font-medium">Ledger posting</p>
                  <p className="mt-1 text-xs leading-relaxed text-blue-800">
                    Once approved, the payroll expense will be posted to the ledger automatically.
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="surface-elevated px-5 py-10">
            <EmptyState
              title="Choose a payroll window"
              description="Pick a payroll period from the left to review draft runs and approve ready payouts."
            />
          </div>
        )}
      </section>
    </div>
  );
}
