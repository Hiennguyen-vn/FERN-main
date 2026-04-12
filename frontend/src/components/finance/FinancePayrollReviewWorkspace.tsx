import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  authApi,
  payrollApi,
  type AuthUserListItem,
  type AuthUsersQuery,
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

interface FinancePayrollReviewWorkspaceProps {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCurrency(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatDate(value?: string | null) {
  if (!value) {
    return '—';
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDateRange(startDate?: string | null, endDate?: string | null) {
  if (!startDate && !endDate) {
    return 'Window unavailable';
  }
  return `${formatDate(startDate)} → ${formatDate(endDate)}`;
}

function formatMonthYear(value?: string | null) {
  if (!value) {
    return 'Payroll review';
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return 'Payroll review';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function normalizeValue(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

function buildPeriodHeadline(period: PayrollPeriodView | null, regionName: string) {
  const explicitName = normalizeValue(period?.name);
  if (explicitName) {
    return explicitName;
  }
  return `${formatMonthYear(period?.startDate || period?.endDate || period?.payDate)} · ${regionName}`;
}

function getRegionName(regionsById: Map<string, ScopeRegion>, regionId?: string | number | null) {
  const key = normalizeValue(regionId);
  if (!key) {
    return 'Selected region';
  }
  return regionsById.get(key)?.name || `Region ${key}`;
}

function getUserDisplay(usersById: Map<string, AuthUserListItem>, userId?: string | number | null) {
  const key = normalizeValue(userId);
  if (!key) {
    return { primary: '—', secondary: undefined as string | undefined };
  }

  const user = usersById.get(key);
  if (!user) {
    return { primary: `User ${key}`, secondary: undefined as string | undefined };
  }

  return {
    primary: user.fullName || user.username,
    secondary: user.employeeCode || user.username || key,
  };
}

export function FinancePayrollReviewWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
}: FinancePayrollReviewWorkspaceProps) {
  const [usersLoading, setUsersLoading] = useState(false);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState('');
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [search, setSearch] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const regionsById = useMemo(
    () => new Map(regions.map((region) => [region.id, region])),
    [regions],
  );
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
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
      const userDisplay = getUserDisplay(usersById, timesheet.userId);
      const outletDisplay = getFinanceOutletDisplay(outletsById, timesheet.outletId);
      const run = runByTimesheetId.get(String(timesheet.id));
      const status = normalizeValue(run?.status).toLowerCase();
      return {
        id: String(timesheet.id),
        employeePrimary: userDisplay.primary,
        employeeSecondary: userDisplay.secondary,
        outletPrimary: outletDisplay.primary,
        outletSecondary: outletDisplay.secondary,
        workHours: toNumber(timesheet.workHours),
        overtimeHours: toNumber(timesheet.overtimeHours),
        lateCount: toNumber(timesheet.lateCount),
        absentDays: toNumber(timesheet.absentDays),
        run,
        runStatus: status,
      };
    });
  }, [outletsById, runByTimesheetId, timesheets, usersById]);

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

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const items = await collectPagedItems<AuthUserListItem, AuthUsersQuery>(
        (query) => authApi.users(token, query),
        {
          sortBy: 'username',
          sortDir: 'asc',
        },
        200,
      );
      setUsers(items);
    } catch (error) {
      console.error('Finance payroll review user load failed', error);
    } finally {
      setUsersLoading(false);
    }
  }, [token]);

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
    void loadUsers();
  }, [loadUsers]);

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
      toast.success('Payroll approved. Refresh Expense Ledger to see the accounting entry after event posting.');
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to approve payroll run'));
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
            Review draft payroll runs for {selectedRegionName}. HR prepares labor input first; Finance approves what is ready to post.
          </p>
        </div>

        {periodsError ? <p className="border-b px-5 py-3 text-xs text-destructive">{periodsError}</p> : null}

        <div className="border-b px-5 py-3">
          <button
            onClick={() => {
              void loadUsers();
              void loadPeriods();
              void loadWorkspace();
            }}
            disabled={usersLoading || periodsLoading || workspaceLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', usersLoading || periodsLoading || workspaceLoading ? 'animate-spin' : '')} />
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
              <div className="border-b px-5 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      <span>Review queue</span>
                    </div>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight">{selectedPeriodHeadline}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Approve only draft payroll runs that HR has already prepared. Expense posting lands in the ledger asynchronously after approval.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium', periodWindowBadgeClass(inferPeriodWindowState(selectedPeriod)))}>
                        {periodWindowLabel(inferPeriodWindowState(selectedPeriod))}
                      </span>
                      <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {selectedRegionName}
                      </span>
                      <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {formatDateRange(selectedPeriod.startDate, selectedPeriod.endDate)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <span>{summary.draftRuns} draft</span>
                    <span>·</span>
                    <span>{summary.approvedRuns} approved</span>
                    <span>·</span>
                    <span>{summary.waitingOnHr} waiting on HR</span>
                    <span>·</span>
                    <span>{summary.overtimeHours.toFixed(2)} OT hrs</span>
                  </div>
                </div>
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
                                  {shortHrRef(row.run.id)} · {row.run.approvedAt ? formatDateTime(row.run.approvedAt) : 'Awaiting finance approval'}
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
                              ? formatCurrency(row.run.netSalary, String(row.run.currencyCode || 'USD'))
                              : '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            {canApprove ? (
                              <button
                                onClick={() => void approveRun(String(row.run?.id))}
                                disabled={busyKey === `approve:${row.run?.id}`}
                                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {busyKey === `approve:${row.run?.id}` ? 'Approving…' : 'Approve'}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {row.run ? 'No finance action' : 'Waiting on HR'}
                              </span>
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
                  <p className="font-medium">Ledger posting is asynchronous after approval</p>
                  <p className="mt-1 text-xs leading-relaxed text-blue-800">
                    Finance approval emits the payroll-approved event. The ledger expense row appears after the finance-service consumer materializes that event.
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
