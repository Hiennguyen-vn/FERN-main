import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  hrApi,
  payrollApi,
  type ContractView,
  type PayrollRunView,
  type PayrollTimesheetView,
  type WorkShiftView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

type HRTab = 'attendance' | 'payroll' | 'contracts';

const TABS: { key: HRTab; label: string; icon: React.ElementType }[] = [
  { key: 'attendance', label: 'Attendance Review', icon: Clock },
  { key: 'payroll', label: 'Payroll & Timesheets', icon: DollarSign },
  { key: 'contracts', label: 'Contracts', icon: FileText },
];

const ATTENDANCE_BADGE: Record<string, string> = {
  present: 'bg-success/10 text-success',
  late: 'bg-warning/10 text-warning',
  absent: 'bg-destructive/10 text-destructive',
  leave: 'bg-muted text-muted-foreground',
  checked_in: 'bg-info/10 text-info',
  checked_out: 'bg-success/10 text-success',
};

const APPROVAL_BADGE: Record<string, string> = {
  approved: 'bg-success/10 text-success',
  pending_review: 'bg-warning/10 text-warning',
  flagged: 'bg-destructive/10 text-destructive',
  rejected: 'bg-destructive/10 text-destructive',
};

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
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

export function HRModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);

  const [activeTab, setActiveTab] = useState<HRTab>('attendance');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [busyKey, setBusyKey] = useState('');

  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [workShifts, setWorkShifts] = useState<WorkShiftView[]>([]);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [attendanceHasMore, setAttendanceHasMore] = useState(false);

  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunView[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsHasMore, setRunsHasMore] = useState(false);

  const [timesheetsLoading, setTimesheetsLoading] = useState(false);
  const [timesheetsError, setTimesheetsError] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [timesheetsTotal, setTimesheetsTotal] = useState(0);
  const [timesheetsHasMore, setTimesheetsHasMore] = useState(false);

  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState('');
  const [contracts, setContracts] = useState<ContractView[]>([]);
  const [contractsTotal, setContractsTotal] = useState(0);
  const [contractsHasMore, setContractsHasMore] = useState(false);

  const attendanceQuery = useListQueryState<{
    outletId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }>({
    initialLimit: 20,
    initialSortBy: 'workDate',
    initialSortDir: 'desc',
    initialFilters: {
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
      status: undefined,
    },
  });
  const runsQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'id',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const timesheetsQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'id',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined },
  });
  const contractsQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'startDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const patchAttendanceFilters = attendanceQuery.patchFilters;
  const patchRunsFilters = runsQuery.patchFilters;
  const patchTimesheetsFilters = timesheetsQuery.patchFilters;
  const patchContractsFilters = contractsQuery.patchFilters;

  const loadAttendance = useCallback(async () => {
    if (!token) return;
    setAttendanceLoading(true);
    setAttendanceError('');
    try {
      const page = await hrApi.workShiftsPaged(token, {
        ...attendanceQuery.query,
        outletId: outletId || undefined,
        startDate: dateFilter,
        endDate: dateFilter,
        status: attendanceQuery.filters.status,
      });
      setWorkShifts(page.items || []);
      setAttendanceTotal(page.total || page.totalCount || 0);
      setAttendanceHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('HR attendance load failed', error);
      setWorkShifts([]);
      setAttendanceTotal(0);
      setAttendanceHasMore(false);
      setAttendanceError(getErrorMessage(error, 'Unable to load attendance data'));
    } finally {
      setAttendanceLoading(false);
    }
  }, [attendanceQuery.filters.status, attendanceQuery.query, dateFilter, outletId, token]);

  const loadRuns = useCallback(async () => {
    if (!token) return;
    setRunsLoading(true);
    setRunsError('');
    try {
      const page = await payrollApi.runs(token, {
        ...runsQuery.query,
        outletId: outletId || undefined,
        status: runsQuery.filters.status,
      });
      setPayrollRuns(page.items || []);
      setRunsTotal(page.total || page.totalCount || 0);
      setRunsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('HR payroll runs load failed', error);
      setPayrollRuns([]);
      setRunsTotal(0);
      setRunsHasMore(false);
      setRunsError(getErrorMessage(error, 'Unable to load payroll runs'));
    } finally {
      setRunsLoading(false);
    }
  }, [outletId, runsQuery.filters.status, runsQuery.query, token]);

  const loadTimesheets = useCallback(async () => {
    if (!token) return;
    setTimesheetsLoading(true);
    setTimesheetsError('');
    try {
      const page = await payrollApi.timesheets(token, {
        ...timesheetsQuery.query,
        outletId: outletId || undefined,
      });
      setTimesheets(page.items || []);
      setTimesheetsTotal(page.total || page.totalCount || 0);
      setTimesheetsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('HR timesheets load failed', error);
      setTimesheets([]);
      setTimesheetsTotal(0);
      setTimesheetsHasMore(false);
      setTimesheetsError(getErrorMessage(error, 'Unable to load timesheets'));
    } finally {
      setTimesheetsLoading(false);
    }
  }, [outletId, timesheetsQuery.query, token]);

  const loadContracts = useCallback(async () => {
    if (!token) return;
    setContractsLoading(true);
    setContractsError('');
    try {
      const page = await hrApi.contractsPaged(token, {
        ...contractsQuery.query,
        outletId: outletId || undefined,
        status: contractsQuery.filters.status,
      });
      setContracts(page.items || []);
      setContractsTotal(page.total || page.totalCount || 0);
      setContractsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('HR contracts load failed', error);
      setContracts([]);
      setContractsTotal(0);
      setContractsHasMore(false);
      setContractsError(getErrorMessage(error, 'Unable to load contracts'));
    } finally {
      setContractsLoading(false);
    }
  }, [contractsQuery.filters.status, contractsQuery.query, outletId, token]);

  useEffect(() => {
    patchAttendanceFilters({
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
    });
    patchRunsFilters({ outletId: outletId || undefined });
    patchTimesheetsFilters({ outletId: outletId || undefined });
    patchContractsFilters({ outletId: outletId || undefined });
  }, [dateFilter, outletId, patchAttendanceFilters, patchContractsFilters, patchRunsFilters, patchTimesheetsFilters]);

  useEffect(() => {
    if (activeTab !== 'attendance') return;
    void loadAttendance();
  }, [activeTab, loadAttendance]);

  useEffect(() => {
    if (activeTab !== 'payroll') return;
    void Promise.all([loadRuns(), loadTimesheets()]);
  }, [activeTab, loadRuns, loadTimesheets]);

  useEffect(() => {
    if (activeTab !== 'contracts') return;
    void loadContracts();
  }, [activeTab, loadContracts]);

  const attendanceStats = useMemo(() => {
    const pendingReview = workShifts.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'pending_review').length;
    const flagged = workShifts.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'flagged').length;
    const present = workShifts.filter((row) => ['present', 'late', 'checked_in', 'checked_out'].includes(String(row.attendanceStatus || '').toLowerCase())).length;
    const absent = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'absent').length;
    return { pendingReview, flagged, present, absent };
  }, [workShifts]);

  const payrollStats = useMemo(() => {
    const pendingRuns = payrollRuns.filter((row) => String(row.status || '').toLowerCase() !== 'approved').length;
    const approvedRuns = payrollRuns.filter((row) => String(row.status || '').toLowerCase() === 'approved').length;
    const overtimeHours = timesheets.reduce((sum, row) => sum + toNumber(row.overtimeHours), 0);
    return { pendingRuns, approvedRuns, overtimeHours };
  }, [payrollRuns, timesheets]);

  const contractStats = useMemo(() => {
    const active = contracts.filter((row) => String(row.status || '').toLowerCase() === 'active').length;
    const terminated = contracts.filter((row) => String(row.status || '').toLowerCase() === 'terminated').length;
    const expiring = contracts.filter((row) => {
      const status = String(row.status || '').toLowerCase();
      return status === 'expiring' || status === 'expiring_soon';
    }).length;
    return { active, terminated, expiring };
  }, [contracts]);

  const updateAttendance = async (workShiftId: string, attendanceStatus: string) => {
    if (!token) return;
    setBusyKey(`attendance:${workShiftId}:${attendanceStatus}`);
    try {
      await hrApi.updateAttendance(token, workShiftId, {
        attendanceStatus,
        note: 'Updated from HR attendance review',
      });
      toast.success('Attendance updated');
      await loadAttendance();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to update attendance'));
    } finally {
      setBusyKey('');
    }
  };

  const approveRun = async (payrollId: string) => {
    if (!token) return;
    setBusyKey(`approve:${payrollId}`);
    try {
      await payrollApi.approveRun(token, payrollId);
      toast.success('Payroll run approved');
      await loadRuns();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to approve payroll run'));
    } finally {
      setBusyKey('');
    }
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="HR" />;
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {activeTab === 'attendance' ? (
          <div className="space-y-4">
            <div className="surface-elevated p-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Business Date</span>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                />
              </div>
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={attendanceQuery.searchInput}
                  onChange={(event) => attendanceQuery.setSearchInput(event.target.value)}
                  placeholder="Filter by user/shift/status"
                  className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                />
              </div>
              <select
                value={attendanceQuery.filters.status || 'all'}
                onChange={(event) => attendanceQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                className="h-8 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="all">All statuses</option>
                <option value="pending_review">Pending review</option>
                <option value="flagged">Flagged</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="approved">Approved</option>
              </select>
              <button
                onClick={() => void loadAttendance()}
                disabled={attendanceLoading}
                className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', attendanceLoading ? 'animate-spin' : '')} /> Refresh
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Pending Review', value: attendanceStats.pendingReview, icon: Clock },
                { label: 'Flagged', value: attendanceStats.flagged, icon: AlertTriangle },
                { label: 'Present', value: attendanceStats.present, icon: CheckCircle2 },
                { label: 'Absent', value: attendanceStats.absent, icon: AlertTriangle },
              ].map((kpi) => (
                <div key={kpi.label} className="surface-elevated p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</span>
                  </div>
                  <p className="text-xl font-semibold">{kpi.value}</p>
                </div>
              ))}
            </div>

            <div className="surface-elevated p-4 space-y-3">
              {attendanceError ? <p className="text-xs text-destructive">{attendanceError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Work Shift', 'User', 'Shift', 'Attendance', 'Approval', 'Clock In', 'Clock Out', 'Actions'].map((header) => (
                        <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLoading && workShifts.length === 0 ? (
                      <ListTableSkeleton columns={8} rows={6} />
                    ) : workShifts.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No attendance records found</td></tr>
                    ) : workShifts.map((row) => {
                      const attendanceStatus = String(row.attendanceStatus || 'unknown').toLowerCase();
                      const approvalStatus = String(row.approvalStatus || 'unknown').toLowerCase();
                      const workShiftId = String(row.id);
                      return (
                        <tr key={workShiftId} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-xs font-mono">{workShiftId}</td>
                          <td className="px-4 py-2.5 text-xs">{String(row.userId || '—')}</td>
                          <td className="px-4 py-2.5 text-xs">{String(row.shiftId || '—')}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', ATTENDANCE_BADGE[attendanceStatus] || 'bg-muted text-muted-foreground')}>
                              {attendanceStatus}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', APPROVAL_BADGE[approvalStatus] || 'bg-muted text-muted-foreground')}>
                              {approvalStatus}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.actualStartTime ? new Date(String(row.actualStartTime)).toLocaleTimeString() : '—'}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.actualEndTime ? new Date(String(row.actualEndTime)).toLocaleTimeString() : '—'}</td>
                          <td className="px-4 py-2.5 space-x-2">
                            <button
                              onClick={() => void updateAttendance(workShiftId, 'checked_in')}
                              disabled={busyKey === `attendance:${workShiftId}:checked_in`}
                              className="h-7 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                            >
                              Check in
                            </button>
                            <button
                              onClick={() => void updateAttendance(workShiftId, 'checked_out')}
                              disabled={busyKey === `attendance:${workShiftId}:checked_out`}
                              className="h-7 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                            >
                              Check out
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ListPaginationControls
                total={attendanceTotal}
                limit={attendanceQuery.limit}
                offset={attendanceQuery.offset}
                hasMore={attendanceHasMore}
                disabled={attendanceLoading}
                onPageChange={attendanceQuery.setPage}
                onLimitChange={attendanceQuery.setPageSize}
              />
            </div>
          </div>
        ) : null}

        {activeTab === 'payroll' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: 'Pending Runs', value: payrollStats.pendingRuns, icon: AlertTriangle },
                { label: 'Approved Runs', value: payrollStats.approvedRuns, icon: CheckCircle2 },
                { label: 'Timesheet Overtime Hours', value: payrollStats.overtimeHours.toFixed(2), icon: Clock },
              ].map((kpi) => (
                <div key={kpi.label} className="surface-elevated p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</span>
                  </div>
                  <p className="text-xl font-semibold">{kpi.value}</p>
                </div>
              ))}
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Payroll Runs ({runsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search runs"
                      value={runsQuery.searchInput}
                      onChange={(event) => runsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={runsQuery.filters.status || 'all'}
                    onChange={(event) => runsQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="approved">Approved</option>
                  </select>
                  <button
                    onClick={() => void loadRuns()}
                    disabled={runsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', runsLoading ? 'animate-spin' : '')} /> Refresh
                  </button>
                </div>
              </div>
              {runsError ? <p className="text-xs text-destructive">{runsError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Run', 'Period', 'User', 'Outlet', 'Status', 'Net Salary', 'Action'].map((header) => (
                        <th key={header} className={cn('text-[11px] px-4 py-2.5', header === 'Net Salary' ? 'text-right' : 'text-left')}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runsLoading && payrollRuns.length === 0 ? (
                      <ListTableSkeleton columns={7} rows={6} />
                    ) : payrollRuns.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No payroll runs found</td></tr>
                    ) : payrollRuns.map((run) => {
                      const runId = String(run.id);
                      const status = String(run.status || '').toLowerCase();
                      return (
                        <tr key={runId} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-xs font-mono">{runId}</td>
                          <td className="px-4 py-2.5 text-xs">{String(run.payrollPeriodName || run.payrollPeriodId || '—')}</td>
                          <td className="px-4 py-2.5 text-xs">{String(run.userId || '—')}</td>
                          <td className="px-4 py-2.5 text-xs">{String(run.outletId || '—')}</td>
                          <td className="px-4 py-2.5 text-xs">{String(run.status || '—')}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">{formatCurrency(run.netSalary, String(run.currencyCode || 'USD'))}</td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => void approveRun(runId)}
                              disabled={status === 'approved' || busyKey === `approve:${runId}`}
                              className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                            >
                              {busyKey === `approve:${runId}` ? 'Approving...' : 'Approve'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ListPaginationControls
                total={runsTotal}
                limit={runsQuery.limit}
                offset={runsQuery.offset}
                hasMore={runsHasMore}
                disabled={runsLoading}
                onPageChange={runsQuery.setPage}
                onLimitChange={runsQuery.setPageSize}
              />
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Timesheets ({timesheetsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search timesheets"
                      value={timesheetsQuery.searchInput}
                      onChange={(event) => timesheetsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <button
                    onClick={() => void loadTimesheets()}
                    disabled={timesheetsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', timesheetsLoading ? 'animate-spin' : '')} /> Refresh
                  </button>
                </div>
              </div>
              {timesheetsError ? <p className="text-xs text-destructive">{timesheetsError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Timesheet', 'Period', 'User', 'Work Days', 'Work Hours', 'Overtime', 'Late Count', 'Absent'].map((header) => (
                        <th key={header} className={cn('text-[11px] px-4 py-2.5', ['Work Days', 'Work Hours', 'Overtime', 'Late Count', 'Absent'].includes(header) ? 'text-right' : 'text-left')}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timesheetsLoading && timesheets.length === 0 ? (
                      <ListTableSkeleton columns={8} rows={6} />
                    ) : timesheets.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No timesheets found</td></tr>
                    ) : timesheets.map((timesheet) => (
                      <tr key={String(timesheet.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(timesheet.id)}</td>
                        <td className="px-4 py-2.5 text-xs">{String(timesheet.payrollPeriodName || timesheet.payrollPeriodId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(timesheet.userId || '—')}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.workDays).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.workHours).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.overtimeHours).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.lateCount)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.absentDays).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPaginationControls
                total={timesheetsTotal}
                limit={timesheetsQuery.limit}
                offset={timesheetsQuery.offset}
                hasMore={timesheetsHasMore}
                disabled={timesheetsLoading}
                onPageChange={timesheetsQuery.setPage}
                onLimitChange={timesheetsQuery.setPageSize}
              />
            </div>
          </div>
        ) : null}

        {activeTab === 'contracts' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: 'Active Contracts', value: contractStats.active, icon: CheckCircle2 },
                { label: 'Expiring Soon', value: contractStats.expiring, icon: AlertTriangle },
                { label: 'Terminated', value: contractStats.terminated, icon: FileText },
              ].map((kpi) => (
                <div key={kpi.label} className="surface-elevated p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</span>
                  </div>
                  <p className="text-xl font-semibold">{kpi.value}</p>
                </div>
              ))}
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Contracts ({contractsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search contracts"
                      value={contractsQuery.searchInput}
                      onChange={(event) => contractsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={contractsQuery.filters.status || 'all'}
                    onChange={(event) => contractsQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="terminated">Terminated</option>
                    <option value="expiring">Expiring</option>
                  </select>
                  <button
                    onClick={() => void loadContracts()}
                    disabled={contractsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', contractsLoading ? 'animate-spin' : '')} /> Refresh
                  </button>
                </div>
              </div>

              {contractsError ? <p className="text-xs text-destructive">{contractsError}</p> : null}

              {contracts.length === 0 && !contractsLoading ? (
                <EmptyState
                  title="No contracts available"
                  description="No contract rows were returned for the current scope and filters."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {['Contract', 'User', 'Employment Type', 'Salary Type', 'Base Salary', 'Start Date', 'End Date', 'Status'].map((header) => (
                          <th key={header} className={cn('text-[11px] px-4 py-2.5', header === 'Base Salary' ? 'text-right' : 'text-left')}>
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contractsLoading && contracts.length === 0 ? (
                        <ListTableSkeleton columns={8} rows={6} />
                      ) : contracts.map((contract) => {
                        const status = String(contract.status || 'unknown').toLowerCase();
                        return (
                          <tr key={String(contract.id)} className="border-b last:border-0">
                            <td className="px-4 py-2.5 text-xs font-mono">{String(contract.id)}</td>
                            <td className="px-4 py-2.5 text-xs">{String(contract.userId || '—')}</td>
                            <td className="px-4 py-2.5 text-xs">{String(contract.employmentType || '—')}</td>
                            <td className="px-4 py-2.5 text-xs">{String(contract.salaryType || '—')}</td>
                            <td className="px-4 py-2.5 text-right text-sm font-mono">{formatCurrency(contract.baseSalary, String(contract.currencyCode || 'USD'))}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(contract.startDate || '—')}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(contract.endDate || '—')}</td>
                            <td className="px-4 py-2.5 text-xs">
                              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', APPROVAL_BADGE[status] || 'bg-muted text-muted-foreground')}>
                                {status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <ListPaginationControls
                total={contractsTotal}
                limit={contractsQuery.limit}
                offset={contractsQuery.offset}
                hasMore={contractsHasMore}
                disabled={contractsLoading}
                onPageChange={contractsQuery.setPage}
                onLimitChange={contractsQuery.setPageSize}
              />
            </div>
          </div>
        ) : null}

        {(attendanceLoading || runsLoading || timesheetsLoading || contractsLoading) ? (
          <div className="hidden">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
