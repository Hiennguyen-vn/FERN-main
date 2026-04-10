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
  authApi,
  hrApi,
  orgApi,
  payrollApi,
  type AuthUserListItem,
  type ContractView,
  type PayrollRunView,
  type PayrollTimesheetView,
  type ScopeOutlet,
  type ShiftView,
  type WorkShiftView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import {
  approvalBadgeClass,
  attendanceBadgeClass,
  contractBadgeClass,
  formatHrEnumLabel,
  getHrOutletDisplay,
  getHrShiftDisplay,
  getHrUserDisplay,
  payrollBadgeClass,
  shortHrRef,
} from '@/components/hr/hr-display';

type HRTab = 'attendance' | 'payroll' | 'contracts';

const TABS: { key: HRTab; label: string; icon: React.ElementType }[] = [
  { key: 'attendance', label: 'Attendance Review', icon: Clock },
  { key: 'payroll', label: 'Payroll & Timesheets', icon: DollarSign },
  { key: 'contracts', label: 'Contracts', icon: FileText },
];

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

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatPeriodLabel(name?: string | null, startDate?: string | null, endDate?: string | null, fallbackId?: string | null) {
  const label = String(name ?? '').trim();
  if (label) return label;
  if (startDate && endDate) return `${startDate} → ${endDate}`;
  return String(fallbackId || '—');
}

export function HRModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);

  const [activeTab, setActiveTab] = useState<HRTab>('attendance');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [busyKey, setBusyKey] = useState('');
  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);
  const [shifts, setShifts] = useState<ShiftView[]>([]);

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
    attendanceStatus?: string;
    approvalStatus?: string;
  }>({
    initialLimit: 20,
    initialSortBy: 'workDate',
    initialSortDir: 'desc',
    initialFilters: {
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
      attendanceStatus: undefined,
      approvalStatus: undefined,
    },
  });
  const runsQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const timesheetsQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'payrollPeriodEndDate',
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
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const outletsById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const shiftsById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);

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
        attendanceStatus: attendanceQuery.filters.attendanceStatus,
        approvalStatus: attendanceQuery.filters.approvalStatus,
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
  }, [
    attendanceQuery.filters.approvalStatus,
    attendanceQuery.filters.attendanceStatus,
    attendanceQuery.query,
    dateFilter,
    outletId,
    token,
  ]);

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
    if (!token) return;
    let active = true;
    void Promise.allSettled([
      orgApi.hierarchy(token),
      authApi.users(token, {
        outletId: outletId || undefined,
        limit: 500,
        offset: 0,
        sortBy: 'username',
        sortDir: 'asc',
      }),
      hrApi.shifts(token, outletId || undefined),
    ]).then(([hierarchyResult, usersResult, shiftsResult]) => {
      if (!active) return;
      if (hierarchyResult.status === 'fulfilled') {
        setOutlets(hierarchyResult.value.outlets || []);
      }
      if (usersResult.status === 'fulfilled') {
        setUsers(usersResult.value.items || []);
      }
      if (shiftsResult.status === 'fulfilled') {
        setShifts(shiftsResult.value || []);
      }
    }).catch((error: unknown) => {
      console.error('HR support data load failed', error);
    });
    return () => {
      active = false;
    };
  }, [outletId, token]);

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
    const pendingReview = workShifts.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'pending').length;
    const approved = workShifts.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'approved').length;
    const late = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'late').length;
    const absent = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'absent').length;
    return { pendingReview, approved, late, absent };
  }, [workShifts]);

  const payrollStats = useMemo(() => {
    const draftRuns = payrollRuns.filter((row) => String(row.status || '').toLowerCase() === 'draft').length;
    const approvedRuns = payrollRuns.filter((row) => String(row.status || '').toLowerCase() === 'approved').length;
    const overtimeHours = timesheets.reduce((sum, row) => sum + toNumber(row.overtimeHours), 0);
    return { draftRuns, approvedRuns, overtimeHours };
  }, [payrollRuns, timesheets]);

  const contractStats = useMemo(() => {
    const active = contracts.filter((row) => String(row.status || '').toLowerCase() === 'active').length;
    const terminated = contracts.filter((row) => String(row.status || '').toLowerCase() === 'terminated').length;
    const expiring = contracts.filter((row) => {
      const status = String(row.status || '').toLowerCase();
      if (status !== 'active' || !row.endDate) return false;
      const today = new Date();
      const endDate = new Date(String(row.endDate));
      const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 30;
    }).length;
    return { active, terminated, expiring };
  }, [contracts]);

  const approveAttendance = async (workShiftId: string) => {
    if (!token) return;
    setBusyKey(`attendance:approve:${workShiftId}`);
    try {
      await hrApi.approveWorkShift(token, workShiftId);
      toast.success('Attendance record approved');
      await loadAttendance();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to approve attendance record'));
    } finally {
      setBusyKey('');
    }
  };

  const rejectAttendance = async (workShiftId: string) => {
    if (!token) return;
    setBusyKey(`attendance:reject:${workShiftId}`);
    try {
      await hrApi.rejectWorkShift(token, workShiftId, { reason: 'Rejected from HR attendance review' });
      toast.success('Attendance record rejected');
      await loadAttendance();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to reject attendance record'));
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
                  placeholder="Search employee, shift, note"
                  className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                />
              </div>
              <select
                value={attendanceQuery.filters.attendanceStatus || 'all'}
                onChange={(event) => attendanceQuery.setFilter('attendanceStatus', event.target.value === 'all' ? undefined : event.target.value)}
                className="h-8 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="all">All attendance</option>
                <option value="pending">Pending</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="leave">Leave</option>
              </select>
              <select
                value={attendanceQuery.filters.approvalStatus || 'all'}
                onChange={(event) => attendanceQuery.setFilter('approvalStatus', event.target.value === 'all' ? undefined : event.target.value)}
                className="h-8 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="all">All review states</option>
                <option value="pending">Pending review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <select
                value={`${attendanceQuery.sortBy || 'workDate'}:${attendanceQuery.sortDir}`}
                onChange={(event) => {
                  const [field, direction] = event.target.value.split(':');
                  attendanceQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                }}
                className="h-8 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="workDate:desc">Latest work date</option>
                <option value="approvalStatus:asc">Pending first</option>
                <option value="userId:asc">Employee A-Z</option>
                <option value="createdAt:desc">Last updated</option>
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
                { label: 'Approved', value: attendanceStats.approved, icon: CheckCircle2 },
                { label: 'Late', value: attendanceStats.late, icon: AlertTriangle },
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
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Attendance Review ({attendanceTotal})</h3>
                  <p className="text-xs text-muted-foreground">Review shift records by attendance outcome and approval state for the selected business date.</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Shift Record', 'Employee', 'Shift', 'Attendance', 'Review', 'Clock', 'Note', 'Actions'].map((header) => (
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
                      const canReview = approvalStatus === 'pending';
                      const userDisplay = getHrUserDisplay(usersById, row.userId);
                      const shiftDisplay = getHrShiftDisplay(shiftsById, row.shiftId);
                      const outletDisplay = getHrOutletDisplay(outletsById, row.outletId);
                      return (
                        <tr key={workShiftId} className="border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{shortHrRef(workShiftId)}</span>
                              <span className="text-[11px] text-muted-foreground">{formatDate(row.workDate)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{userDisplay.primary}</span>
                              {userDisplay.secondary ? (
                                <span className="text-[11px] text-muted-foreground">{userDisplay.secondary}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{shiftDisplay.primary}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {[shiftDisplay.secondary, outletDisplay.primary].filter(Boolean).join(' · ') || '—'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', attendanceBadgeClass(attendanceStatus))}>
                              {formatHrEnumLabel(attendanceStatus)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', approvalBadgeClass(approvalStatus))}>
                              {formatHrEnumLabel(approvalStatus)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <div className="flex flex-col">
                              <span>In {formatTime(row.actualStartTime)}</span>
                              <span>Out {formatTime(row.actualEndTime)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(row.note || '—')}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => void approveAttendance(workShiftId)}
                                disabled={!canReview || busyKey === `attendance:approve:${workShiftId}`}
                                className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                              >
                                {busyKey === `attendance:approve:${workShiftId}` ? 'Approving...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => void rejectAttendance(workShiftId)}
                                disabled={!canReview || busyKey === `attendance:reject:${workShiftId}`}
                                className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                              >
                                {busyKey === `attendance:reject:${workShiftId}` ? 'Rejecting...' : 'Reject'}
                              </button>
                            </div>
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
                { label: 'Draft Runs', value: payrollStats.draftRuns, icon: AlertTriangle },
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
                <div>
                  <h3 className="text-sm font-semibold">Payroll Runs ({runsTotal})</h3>
                  <p className="text-xs text-muted-foreground">Generated payroll rows can be approved from draft after timesheets are finalized.</p>
                </div>
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
                    <option value="rejected">Rejected</option>
                    <option value="paid">Paid</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${runsQuery.sortBy || 'createdAt'}:${runsQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      runsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="createdAt:desc">Newest first</option>
                    <option value="approvedAt:desc">Last approved</option>
                    <option value="netSalary:desc">Net salary ↓</option>
                    <option value="netSalary:asc">Net salary ↑</option>
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
                      const userDisplay = getHrUserDisplay(usersById, run.userId);
                      const outletDisplay = getHrOutletDisplay(outletsById, run.outletId);
                      return (
                        <tr key={runId} className="border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{shortHrRef(runId)}</span>
                              <span className="text-[11px] text-muted-foreground">{formatDate(run.createdAt)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">
                                {formatPeriodLabel(run.payrollPeriodName, undefined, undefined, run.payrollPeriodId)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{userDisplay.primary}</span>
                              {userDisplay.secondary ? (
                                <span className="text-[11px] text-muted-foreground">{userDisplay.secondary}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{outletDisplay.primary}</span>
                              {outletDisplay.secondary ? (
                                <span className="text-[11px] font-mono text-muted-foreground">{outletDisplay.secondary}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', payrollBadgeClass(status))}>
                              {formatHrEnumLabel(status)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">{formatCurrency(run.netSalary, String(run.currencyCode || 'USD'))}</td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => void approveRun(runId)}
                              disabled={status !== 'draft' || busyKey === `approve:${runId}`}
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
                <div>
                  <h3 className="text-sm font-semibold">Timesheets ({timesheetsTotal})</h3>
                  <p className="text-xs text-muted-foreground">Timesheets summarize payroll period work days, work hours, overtime, lateness, and absence per employee.</p>
                </div>
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
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${timesheetsQuery.sortBy || 'payrollPeriodEndDate'}:${timesheetsQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      timesheetsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="payrollPeriodEndDate:desc">Latest period</option>
                    <option value="updatedAt:desc">Last updated</option>
                    <option value="overtimeHours:desc">Overtime ↓</option>
                    <option value="workHours:desc">Work hours ↓</option>
                  </select>
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
                      {['Timesheet', 'Period', 'Employee', 'Outlet', 'Work Days', 'Work Hours', 'Overtime', 'Late Count', 'Absent'].map((header) => (
                        <th key={header} className={cn('text-[11px] px-4 py-2.5', ['Work Days', 'Work Hours', 'Overtime', 'Late Count', 'Absent'].includes(header) ? 'text-right' : 'text-left')}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timesheetsLoading && timesheets.length === 0 ? (
                      <ListTableSkeleton columns={9} rows={6} />
                    ) : timesheets.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">No timesheets found</td></tr>
                    ) : timesheets.map((timesheet) => {
                      const userDisplay = getHrUserDisplay(usersById, timesheet.userId);
                      const outletDisplay = getHrOutletDisplay(outletsById, timesheet.outletId);
                      return (
                      <tr key={String(timesheet.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{shortHrRef(timesheet.id)}</span>
                            <span className="text-[11px] text-muted-foreground">{formatDate(timesheet.updatedAt || timesheet.createdAt)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {formatPeriodLabel(
                            timesheet.payrollPeriodName,
                            timesheet.payrollPeriodStartDate,
                            timesheet.payrollPeriodEndDate,
                            timesheet.payrollPeriodId,
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{userDisplay.primary}</span>
                            {userDisplay.secondary ? (
                              <span className="text-[11px] text-muted-foreground">{userDisplay.secondary}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{outletDisplay.primary}</span>
                            {outletDisplay.secondary ? (
                              <span className="text-[11px] font-mono text-muted-foreground">{outletDisplay.secondary}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.workDays).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.workHours).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.overtimeHours).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.lateCount)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.absentDays).toFixed(2)}</td>
                      </tr>
                    )})}
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
                <div>
                  <h3 className="text-sm font-semibold">Contracts ({contractsTotal})</h3>
                  <p className="text-xs text-muted-foreground">Track employment terms, salary basis, and expiry risk from the active contract register.</p>
                </div>
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
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                    <option value="terminated">Terminated</option>
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${contractsQuery.sortBy || 'startDate'}:${contractsQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      contractsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="startDate:desc">Latest start date</option>
                    <option value="endDate:asc">Ending soon</option>
                    <option value="status:asc">Status A-Z</option>
                    <option value="createdAt:desc">Last created</option>
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
                        const userDisplay = getHrUserDisplay(usersById, contract.userId);
                        return (
                          <tr key={String(contract.id)} className="border-b last:border-0">
                            <td className="px-4 py-2.5">
                              <div className="flex flex-col">
                                <span className="text-xs font-medium">{shortHrRef(contract.id)}</span>
                                <span className="text-[11px] text-muted-foreground">{String(contract.regionCode || '—')}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-col">
                                <span className="text-xs font-medium">{userDisplay.primary}</span>
                                {userDisplay.secondary ? (
                                  <span className="text-[11px] text-muted-foreground">{userDisplay.secondary}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-xs">{formatHrEnumLabel(contract.employmentType)}</td>
                            <td className="px-4 py-2.5 text-xs">{formatHrEnumLabel(contract.salaryType)}</td>
                            <td className="px-4 py-2.5 text-right text-sm font-mono">{formatCurrency(contract.baseSalary, String(contract.currencyCode || 'USD'))}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(contract.startDate)}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(contract.endDate)}</td>
                            <td className="px-4 py-2.5 text-xs">
                              <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', contractBadgeClass(status))}>
                                {formatHrEnumLabel(status)}
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
