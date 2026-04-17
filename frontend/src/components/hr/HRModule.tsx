import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Clock,
  FileText,
  DollarSign,
  Users,
  Loader2,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  hrApi,
  orgApi,
  type AuthUserListItem,
  type HrEmployeeView,
  type HrEmployeesQuery,
  type ShiftsQuery,
  type ScopeOutlet,
  type ScopeRegion,
  type ShiftView,
  type WorkShiftView,
} from '@/api/fern-api';
import { hasHrCompensationAccess } from '@/auth/authorization';
import { useAuth } from '@/auth/use-auth';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import {
  approvalBadgeClass,
  attendanceBadgeClass,
  formatHrEnumLabel,
  getHrOutletDisplay,
  getHrShiftDisplay,
  getHrUserDisplay,
  shortHrRef,
} from '@/components/hr/hr-display';
import { PayrollPrepWorkspace } from '@/components/hr/PayrollPrepWorkspace';
import { PayrollModule as PayrollWorkspace } from '@/components/hr/PayrollModule';
import { ContractsWorkspace } from '@/components/hr/ContractsWorkspace';
import { EmployeeProfileWorkspace } from '@/components/hr/EmployeeProfileWorkspace';
import { collectPagedItems } from '@/lib/collect-paged-items';
import { HR_TAB_ITEMS, type HrTab } from '@/components/hr/hr-workspace-config';

const TAB_ICONS: Record<HrTab, React.ElementType> = {
  attendance: Clock,
  employees: Users,
  contracts: FileText,
  payroll: DollarSign,
  prep: FileText,
};

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDuration(startTime: string | null | undefined, endTime: string | null | undefined) {
  if (!startTime || !endTime) return '—';
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return '—';
  const totalMinutes = Math.round((end - start) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function HRModule() {
  const { token, scope } = useShellRuntime();
  const { session } = useAuth();
  const outletId = normalizeNumeric(scope.outletId);
  const canAccessCompensation = hasHrCompensationAccess(session);

  const [activeTab, setActiveTab] = useState<HrTab>('attendance');
  const today = new Date().toISOString().slice(0, 10);
  const [startDateFilter, setStartDateFilter] = useState(today);
  const [endDateFilter, setEndDateFilter] = useState(today);
  const [busyKey, setBusyKey] = useState('');
  const [rejectDialog, setRejectDialog] = useState<{ workShiftId: string; reason: string } | null>(null);
  const rejectReasonRef = useRef<HTMLInputElement>(null);
  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [hrEmployees, setHrEmployees] = useState<HrEmployeeView[]>([]);
  const [usersError, setUsersError] = useState('');
  const [regions, setRegions] = useState<ScopeRegion[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);
  const [shifts, setShifts] = useState<ShiftView[]>([]);

  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [workShifts, setWorkShifts] = useState<WorkShiftView[]>([]);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [attendanceHasMore, setAttendanceHasMore] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [selectedAttendanceIds, setSelectedAttendanceIds] = useState<Set<string>>(new Set());
  const [bulkAttendanceBusy, setBulkAttendanceBusy] = useState(false);

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
      startDate: today,
      endDate: today,
      attendanceStatus: undefined,
      approvalStatus: undefined,
    },
  });
  const patchAttendanceFilters = attendanceQuery.patchFilters;
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const outletsById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const shiftsById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);
  const visibleTabs = useMemo(
    () => HR_TAB_ITEMS.filter((tab) => tab.key === 'attendance' || tab.key === 'employees' || canAccessCompensation),
    [canAccessCompensation],
  );

  const loadAttendance = useCallback(async () => {
    if (!token) return;
    setAttendanceLoading(true);
    setAttendanceError('');
    try {
      const page = await hrApi.workShiftsPaged(token, {
        ...attendanceQuery.query,
        outletId: outletId || undefined,
        startDate: startDateFilter,
        endDate: endDateFilter,
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
    startDateFilter,
    endDateFilter,
    outletId,
    token,
  ]);

  useEffect(() => {
    patchAttendanceFilters({
      outletId: outletId || undefined,
      startDate: startDateFilter,
      endDate: endDateFilter,
    });
  }, [startDateFilter, endDateFilter, outletId, patchAttendanceFilters]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void Promise.allSettled([
      orgApi.hierarchy(token),
      collectPagedItems<HrEmployeeView, HrEmployeesQuery>(
        (query) => hrApi.employees(token, query),
        { outletId: outletId || undefined, sortBy: 'fullName', sortDir: 'asc' },
        200,
      ),
      collectPagedItems<ShiftView, ShiftsQuery>(
        (query) => hrApi.shiftsPaged(token, query),
        { outletId: outletId || undefined, sortBy: 'startTime', sortDir: 'asc' },
      ),
    ]).then(([hierarchyResult, employeesResult, shiftsResult]) => {
      if (!active) return;
      if (hierarchyResult.status === 'fulfilled') {
        setRegions(hierarchyResult.value.regions || []);
        setOutlets(hierarchyResult.value.outlets || []);
      }
      if (employeesResult.status === 'fulfilled') {
        const emps = employeesResult.value || [];
        setHrEmployees(emps);
        // Derive AuthUserListItem[] for backward-compatible components
        setUsers(emps.map((e) => ({
          id: e.id,
          username: e.username,
          fullName: e.fullName,
          employeeCode: e.employeeCode,
          email: e.email,
          status: e.status,
        })));
        setUsersError('');
      } else {
        console.error('[HR] employees load rejected:', employeesResult.reason);
        setUsersError(getErrorMessage(employeesResult.reason, 'Unable to load employee list'));
      }
      if (shiftsResult.status === 'fulfilled') {
        setShifts(shiftsResult.value || []);
      }
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
    if (activeTab === 'attendance' || activeTab === 'employees' || canAccessCompensation) {
      return;
    }
    setActiveTab('attendance');
  }, [activeTab, canAccessCompensation]);

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

  const openRejectDialog = (workShiftId: string) => {
    setRejectDialog({ workShiftId, reason: '' });
    setTimeout(() => rejectReasonRef.current?.focus(), 60);
  };

  const submitRejectAttendance = async () => {
    if (!rejectDialog || !token) return;
    const reason = rejectDialog.reason.trim();
    if (!reason) { toast.error('Please enter a rejection reason'); return; }
    setBusyKey(`attendance:reject:${rejectDialog.workShiftId}`);
    try {
      await hrApi.rejectWorkShift(token, rejectDialog.workShiftId, { reason });
      toast.success('Attendance record rejected');
      setRejectDialog(null);
      await loadAttendance();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to reject attendance record'));
    } finally {
      setBusyKey('');
    }
  };

  // Load pending count for badge
  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const page = await hrApi.workShiftsPaged(token, { approvalStatus: 'pending', limit: 1, offset: 0 });
        setPendingCount(page.total || page.totalCount || 0);
      } catch { /* ignore */ }
    })();
  }, [token, workShifts]); // re-run after attendance changes

  const toggleAttendanceSelect = (id: string) => {
    setSelectedAttendanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const pendingWorkShifts = useMemo(
    () => workShifts.filter((ws) => String(ws.approvalStatus || '').toLowerCase() === 'pending'),
    [workShifts],
  );

  const toggleAttendanceSelectAll = () => {
    if (selectedAttendanceIds.size === pendingWorkShifts.length) {
      setSelectedAttendanceIds(new Set());
    } else {
      setSelectedAttendanceIds(new Set(pendingWorkShifts.map((ws) => String(ws.id))));
    }
  };

  const bulkApproveAttendance = async () => {
    if (selectedAttendanceIds.size === 0 || !token) return;
    setBulkAttendanceBusy(true);
    const results = await Promise.allSettled(
      Array.from(selectedAttendanceIds).map((id) => hrApi.approveWorkShift(token, id)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    if (succeeded > 0) toast.success(`${succeeded} record(s) approved`);
    if (failed > 0) toast.error(`${failed} record(s) failed`);
    setSelectedAttendanceIds(new Set());
    setBulkAttendanceBusy(false);
    await loadAttendance();
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="HR" />;
  }

  return (
    <>
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {visibleTabs.map((tab) => {
          const Icon = TAB_ICONS[tab.key];
          return (
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
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.key === 'attendance' && pendingCount > 0 ? (
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive text-destructive-foreground font-medium">{pendingCount}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {!canAccessCompensation ? (
          <div className="surface-elevated border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
              <div>
                <p className="text-sm font-medium text-amber-900">Compensation surfaces are hidden in this scope</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Contracts and payroll prep stay admin-only until the backend exposes scoped access rules that match these screens.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'attendance' ? (
          <div className="space-y-4">
            {/* Filter bar — 2 rows */}
            <div className="surface-elevated p-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">From</span>
                <input type="date" value={startDateFilter} max={endDateFilter} onChange={(e) => setStartDateFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-3 text-xs" />
                <span className="text-xs text-muted-foreground">To</span>
                <input type="date" value={endDateFilter} min={startDateFilter} onChange={(e) => setEndDateFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-3 text-xs" />
                <button onClick={() => { setStartDateFilter(today); setEndDateFilter(today); }} className="h-8 px-2 rounded border text-[10px] text-muted-foreground hover:bg-accent" title="Reset to today">Today</button>
                <button onClick={() => { const d = new Date(); const day = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); setStartDateFilter(mon.toISOString().slice(0, 10)); setEndDateFilter(sun.toISOString().slice(0, 10)); }} className="h-8 px-2 rounded border text-[10px] text-muted-foreground hover:bg-accent" title="This week">This week</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative max-w-sm flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input value={attendanceQuery.searchInput} onChange={(e) => attendanceQuery.setSearchInput(e.target.value)} placeholder="Search employee, shift, note" className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs" />
                </div>
                <select value={attendanceQuery.filters.attendanceStatus || 'all'} onChange={(e) => attendanceQuery.setFilter('attendanceStatus', e.target.value === 'all' ? undefined : e.target.value)} className="h-8 rounded-md border border-input bg-background px-3 text-xs">
                  <option value="all">All attendance</option>
                  <option value="pending">Pending</option>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="leave">Leave</option>
                </select>
                <select value={attendanceQuery.filters.approvalStatus || 'all'} onChange={(e) => attendanceQuery.setFilter('approvalStatus', e.target.value === 'all' ? undefined : e.target.value)} className="h-8 rounded-md border border-input bg-background px-3 text-xs">
                  <option value="all">All review states</option>
                  <option value="pending">Pending review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <select value={`${attendanceQuery.sortBy || 'workDate'}:${attendanceQuery.sortDir}`} onChange={(e) => { const [f, d] = e.target.value.split(':'); attendanceQuery.applySort(f, d === 'asc' ? 'asc' : 'desc'); }} className="h-8 rounded-md border border-input bg-background px-3 text-xs">
                  <option value="workDate:desc">Latest work date</option>
                  <option value="approvalStatus:asc">Pending first</option>
                  <option value="userId:asc">Employee A-Z</option>
                  <option value="createdAt:desc">Last updated</option>
                </select>
                <button onClick={() => void loadAttendance()} disabled={attendanceLoading} className="h-8 px-2.5 rounded border text-xs flex items-center gap-1 hover:bg-accent disabled:opacity-60">
                  <RefreshCw className={cn('h-3.5 w-3.5', attendanceLoading ? 'animate-spin' : '')} /> Refresh
                </button>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              {attendanceError ? <p className="text-xs text-destructive">{attendanceError}</p> : null}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Attendance Review ({attendanceTotal})</h3>
                  <p className="text-xs text-muted-foreground">Review shift records by attendance outcome and approval state for the selected date range.</p>
                </div>
              </div>

              {/* Bulk action bar */}
              {selectedAttendanceIds.size > 0 ? (
                <div className="flex items-center gap-3 p-3 rounded-md bg-primary/5 border border-primary/20">
                  <span className="text-xs font-medium">{selectedAttendanceIds.size} selected</span>
                  <button
                    onClick={() => void bulkApproveAttendance()}
                    disabled={bulkAttendanceBusy}
                    className="h-7 px-2.5 rounded bg-primary text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Approve selected
                  </button>
                  <button onClick={() => setSelectedAttendanceIds(new Set())} className="text-[10px] text-muted-foreground hover:text-foreground ml-auto">Clear</button>
                </div>
              ) : null}

              <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-card">
                      <th className="px-2 py-2.5 w-8">
                        <input type="checkbox" checked={selectedAttendanceIds.size === pendingWorkShifts.length && pendingWorkShifts.length > 0} onChange={toggleAttendanceSelectAll} className="rounded border-input" />
                      </th>
                      {['Shift Record', 'Employee', 'Shift', 'Attendance', 'Review', 'Clock', 'Duration', 'Note', 'Actions'].map((header) => (
                        <th key={header} className="text-left text-xs px-4 py-2.5">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLoading && workShifts.length === 0 ? (
                      <ListTableSkeleton columns={10} rows={6} />
                    ) : workShifts.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">No attendance records found</td></tr>
                    ) : workShifts.map((row) => {
                      const attendanceStatus = String(row.attendanceStatus || 'unknown').toLowerCase();
                      const approvalStatus = String(row.approvalStatus || 'unknown').toLowerCase();
                      const workShiftId = String(row.id);
                      const canReview = approvalStatus === 'pending';
                      const userDisplay = getHrUserDisplay(usersById, row.userId);
                      const shiftDisplay = getHrShiftDisplay(shiftsById, row.shiftId);
                      const outletDisplay = getHrOutletDisplay(outletsById, row.outletId);
                      return (
                        <tr key={workShiftId} className={cn('border-b last:border-0', selectedAttendanceIds.has(workShiftId) ? 'bg-primary/5' : '')}>
                          <td className="px-2 py-2.5">
                            {canReview ? (
                              <input type="checkbox" checked={selectedAttendanceIds.has(workShiftId)} onChange={() => toggleAttendanceSelect(workShiftId)} className="rounded border-input" />
                            ) : <span className="block w-4" />}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{shortHrRef(workShiftId)}</span>
                              <span className="text-[11px] text-muted-foreground">{formatDate(row.workDate)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{userDisplay.primary}</span>
                              {userDisplay.secondary ? <span className="text-[11px] text-muted-foreground">{userDisplay.secondary}</span> : null}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{shiftDisplay.primary}</span>
                              {shiftDisplay.secondary ? <span className="text-[11px] text-muted-foreground">{shiftDisplay.secondary}</span> : null}
                              <span className="text-[11px] text-muted-foreground">{outletDisplay.primary}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', attendanceBadgeClass(attendanceStatus))}>{formatHrEnumLabel(attendanceStatus)}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', approvalBadgeClass(approvalStatus))}>{formatHrEnumLabel(approvalStatus)}</span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <div className="flex flex-col">
                              <span>In {formatTime(row.actualStartTime)}</span>
                              <span>Out {formatTime(row.actualEndTime)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{formatDuration(row.actualStartTime, row.actualEndTime)}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[120px] truncate">{String(row.note || '—')}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              <button onClick={() => void approveAttendance(workShiftId)} disabled={!canReview || busyKey === `attendance:approve:${workShiftId}`} className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50">
                                {busyKey === `attendance:approve:${workShiftId}` ? 'Approving...' : 'Approve'}
                              </button>
                              <button onClick={() => openRejectDialog(workShiftId)} disabled={!canReview || busyKey === `attendance:reject:${workShiftId}`} className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50">
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

        {activeTab === 'employees' ? (
          <EmployeeProfileWorkspace
            token={token}
            users={users}
            hrEmployees={hrEmployees}
            usersError={usersError}
            outlets={outlets}
            regions={regions}
            scopeOutletId={outletId || undefined}
          />
        ) : null}

        {activeTab === 'payroll' ? (
          <PayrollWorkspace
            token={token}
            users={users}
            outlets={outlets}
            scopeRegionId={normalizeNumeric(scope.regionId)}
          />
        ) : null}

        {activeTab === 'prep' ? (
          <PayrollPrepWorkspace
            token={token}
            users={users}
            outlets={outlets}
            regions={regions}
            scopeRegionId={normalizeNumeric(scope.regionId)}
            scopeOutletId={outletId || undefined}
          />
        ) : null}

        {activeTab === 'contracts' ? (
          <ContractsWorkspace
            token={token}
            outletId={outletId || undefined}
            users={users}
            outlets={outlets}
            regions={regions}
          />
        ) : null}

        {attendanceLoading ? (
          <div className="hidden">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}
      </div>
    </div>

    {rejectDialog ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">Reject Attendance Record</h3>
            <button type="button" onClick={() => setRejectDialog(null)} className="rounded p-1 hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-5 space-y-3">
            <p className="text-sm text-muted-foreground">Provide a reason so the employee understands why this record was rejected.</p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Rejection reason <span className="text-destructive">*</span></label>
              <input
                ref={rejectReasonRef}
                type="text"
                value={rejectDialog.reason}
                onChange={(e) => setRejectDialog((prev) => prev ? { ...prev, reason: e.target.value } : prev)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitRejectAttendance(); }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder="e.g. Clock-in time does not match shift"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-4">
            <button type="button" onClick={() => setRejectDialog(null)} className="h-9 rounded-md border border-border px-4 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitRejectAttendance()}
              disabled={!!busyKey}
              className="h-9 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {busyKey ? 'Rejecting...' : 'Confirm reject'}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
