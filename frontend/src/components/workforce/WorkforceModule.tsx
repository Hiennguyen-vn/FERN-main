import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  Timer,
  TrendingUp,
  UserCheck,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  authApi,
  hrApi,
  orgApi,
  payrollApi,
  type AuthUserListItem,
  type PayrollTimesheetView,
  type ScopeOutlet,
  type ShiftView,
  type WorkShiftView,
} from '@/api/fern-api';
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
  scheduleBadgeClass,
  shortHrRef,
} from '@/components/hr/hr-display';
import { buildWorkShiftAssignmentPayloads } from '@/components/workforce/work-shift-assignment';

type WorkforceTab = 'attendance' | 'overtime' | 'leave';

const TABS: { key: WorkforceTab; label: string; icon: React.ElementType }[] = [
  { key: 'attendance', label: 'Shift Schedule', icon: UserCheck },
  { key: 'overtime', label: 'Overtime', icon: Timer },
  { key: 'leave', label: 'Leave', icon: CalendarDays },
];

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
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

export function WorkforceModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);

  const [activeTab, setActiveTab] = useState<WorkforceTab>('attendance');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [busyKey, setBusyKey] = useState('');
  const [assignmentUserQuery, setAssignmentUserQuery] = useState('');
  const [assignmentDraft, setAssignmentDraft] = useState({
    userIds: [] as string[],
    shiftId: '',
    workDate: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);
  const [shifts, setShifts] = useState<ShiftView[]>([]);

  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [workShifts, setWorkShifts] = useState<WorkShiftView[]>([]);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [attendanceHasMore, setAttendanceHasMore] = useState(false);

  const [overtimeLoading, setOvertimeLoading] = useState(false);
  const [overtimeError, setOvertimeError] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [timesheetsTotal, setTimesheetsTotal] = useState(0);
  const [timesheetsHasMore, setTimesheetsHasMore] = useState(false);

  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [leaveRequests, setLeaveRequests] = useState<WorkShiftView[]>([]);
  const [leaveTotal, setLeaveTotal] = useState(0);
  const [leaveHasMore, setLeaveHasMore] = useState(false);

  const attendanceQuery = useListQueryState<{
    outletId?: string;
    startDate?: string;
    endDate?: string;
    scheduleStatus?: string;
    approvalStatus?: string;
  }>({
    initialLimit: 20,
    initialSortBy: 'workDate',
    initialSortDir: 'desc',
    initialFilters: {
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
      scheduleStatus: undefined,
      approvalStatus: undefined,
    },
  });
  const overtimeQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'overtimeHours',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined },
  });
  const leaveQuery = useListQueryState<{
    outletId?: string;
    startDate?: string;
    endDate?: string;
    approvalStatus?: string;
  }>({
    initialLimit: 20,
    initialSortBy: 'workDate',
    initialSortDir: 'desc',
    initialFilters: {
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
      approvalStatus: undefined,
    },
  });

  const patchAttendanceFilters = attendanceQuery.patchFilters;
  const patchOvertimeFilters = overtimeQuery.patchFilters;
  const patchLeaveFilters = leaveQuery.patchFilters;

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const outletsById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const shiftsById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);
  const currentOutletDisplay = useMemo(() => getHrOutletDisplay(outletsById, outletId), [outletsById, outletId]);
  const assignableUsers = useMemo(
    () => users.slice().sort((left, right) => (left.fullName || left.username).localeCompare(right.fullName || right.username)),
    [users],
  );
  const assignableShifts = useMemo(
    () => shifts
      .filter((shift) => String(shift.status || 'active').toLowerCase() !== 'inactive')
      .slice()
      .sort((left, right) => (left.code || left.name || left.id).localeCompare(right.code || right.name || right.id)),
    [shifts],
  );
  const filteredAssignableUsers = useMemo(() => {
    const query = assignmentUserQuery.trim().toLowerCase();
    if (!query) return assignableUsers;
    return assignableUsers.filter((user) => {
      const haystack = [user.fullName, user.username, user.employeeCode]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return haystack.includes(query);
    });
  }, [assignableUsers, assignmentUserQuery]);
  const allVisibleUsersSelected = useMemo(
    () => filteredAssignableUsers.length > 0
      && filteredAssignableUsers.every((user) => assignmentDraft.userIds.includes(user.id)),
    [assignmentDraft.userIds, filteredAssignableUsers],
  );

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
        scheduleStatus: attendanceQuery.filters.scheduleStatus,
        approvalStatus: attendanceQuery.filters.approvalStatus,
      });
      setWorkShifts(page.items || []);
      setAttendanceTotal(page.total || page.totalCount || 0);
      setAttendanceHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Workforce attendance load failed', error);
      setWorkShifts([]);
      setAttendanceTotal(0);
      setAttendanceHasMore(false);
      setAttendanceError(getErrorMessage(error, 'Unable to load attendance rows'));
    } finally {
      setAttendanceLoading(false);
    }
  }, [
    attendanceQuery.filters.approvalStatus,
    attendanceQuery.filters.scheduleStatus,
    attendanceQuery.query,
    dateFilter,
    outletId,
    token,
  ]);

  const loadOvertime = useCallback(async () => {
    if (!token) return;
    setOvertimeLoading(true);
    setOvertimeError('');
    try {
      const page = await payrollApi.timesheets(token, {
        ...overtimeQuery.query,
        outletId: outletId || undefined,
      });
      setTimesheets(page.items || []);
      setTimesheetsTotal(page.total || page.totalCount || 0);
      setTimesheetsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Workforce overtime load failed', error);
      setTimesheets([]);
      setTimesheetsTotal(0);
      setTimesheetsHasMore(false);
      setOvertimeError(getErrorMessage(error, 'Unable to load overtime rows'));
    } finally {
      setOvertimeLoading(false);
    }
  }, [outletId, overtimeQuery.query, token]);

  const loadLeave = useCallback(async () => {
    if (!token) return;
    setLeaveLoading(true);
    setLeaveError('');
    try {
      const page = await hrApi.timeOffPaged(token, {
        ...leaveQuery.query,
        outletId: outletId || undefined,
        startDate: dateFilter,
        endDate: dateFilter,
        approvalStatus: leaveQuery.filters.approvalStatus,
      });
      setLeaveRequests(page.items || []);
      setLeaveTotal(page.total || page.totalCount || 0);
      setLeaveHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Workforce leave load failed', error);
      setLeaveRequests([]);
      setLeaveTotal(0);
      setLeaveHasMore(false);
      setLeaveError(getErrorMessage(error, 'Unable to load leave requests'));
    } finally {
      setLeaveLoading(false);
    }
  }, [dateFilter, leaveQuery.filters.approvalStatus, leaveQuery.query, outletId, token]);

  useEffect(() => {
    patchAttendanceFilters({
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
    });
    patchOvertimeFilters({ outletId: outletId || undefined });
    patchLeaveFilters({
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
    });
    setAssignmentDraft((prev) => ({ ...prev, workDate: dateFilter }));
  }, [dateFilter, outletId, patchAttendanceFilters, patchLeaveFilters, patchOvertimeFilters]);

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
      console.error('Workforce support data load failed', error);
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
    if (activeTab !== 'overtime') return;
    void loadOvertime();
  }, [activeTab, loadOvertime]);

  useEffect(() => {
    if (activeTab !== 'leave') return;
    void loadLeave();
  }, [activeTab, loadLeave]);

  const attendanceStats = useMemo(() => {
    const assigned = workShifts.length;
    const scheduled = workShifts.filter((row) => String(row.scheduleStatus || '').toLowerCase() === 'scheduled').length;
    const pendingAttendance = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'pending').length;
    const pendingReview = workShifts.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'pending').length;
    return { assigned, scheduled, pendingAttendance, pendingReview };
  }, [workShifts]);

  const overtimeRows = useMemo(
    () => timesheets.filter((row) => toNumber(row.overtimeHours) > 0 || toNumber(row.lateCount) > 0 || toNumber(row.absentDays) > 0),
    [timesheets],
  );

  const overtimeStats = useMemo(() => {
    const overtimeOnlyRows = timesheets.filter((row) => toNumber(row.overtimeHours) > 0);
    const totalOvertime = timesheets.reduce((sum, row) => sum + toNumber(row.overtimeHours), 0);
    const avgOvertime = overtimeOnlyRows.length > 0 ? totalOvertime / overtimeOnlyRows.length : 0;
    const totalLate = timesheets.reduce((sum, row) => sum + toNumber(row.lateCount), 0);
    const totalAbsentDays = timesheets.reduce((sum, row) => sum + toNumber(row.absentDays), 0);
    return { totalOvertime, avgOvertime, totalLate, totalAbsentDays };
  }, [timesheets]);

  const leaveStats = useMemo(() => {
    const pending = leaveRequests.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'pending').length;
    const approved = leaveRequests.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'approved').length;
    const rejected = leaveRequests.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'rejected').length;
    return { total: leaveRequests.length, pending, approved, rejected };
  }, [leaveRequests]);

  const reviewWorkShift = async (workShiftId: string, decision: 'approve' | 'reject', reload: () => Promise<void>) => {
    if (!token) return;
    const key = `${decision}:${workShiftId}`;
    setBusyKey(key);
    try {
      if (decision === 'approve') {
        await hrApi.approveWorkShift(token, workShiftId);
        toast.success('Request approved');
      } else {
        await hrApi.rejectWorkShift(token, workShiftId, { reason: 'Rejected from workforce review' });
        toast.success('Request rejected');
      }
      await reload();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, `Unable to ${decision} request`));
    } finally {
      setBusyKey('');
    }
  };

  const assignWorkShift = async () => {
    if (!token) return;
    let payloads;
    try {
      payloads = buildWorkShiftAssignmentPayloads(assignmentDraft);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to prepare shift assignments'));
      return;
    }
    setBusyKey('assign-work-shift');
    try {
      const failures: string[] = [];
      let successCount = 0;
      for (const payload of payloads) {
        try {
          await hrApi.createWorkShift(token, payload);
          successCount += 1;
        } catch (error: unknown) {
          failures.push(getErrorMessage(error, `Unable to assign user ${payload.userId}`));
        }
      }
      if (successCount > 0) {
        toast.success(
          successCount === 1
            ? '1 shift assigned'
            : `${successCount} shifts assigned`,
        );
      }
      if (failures.length > 0) {
        toast.error(
          failures.length === 1
            ? failures[0]
            : `${failures.length} assignments failed. Check for duplicate shift/user/date combinations.`,
        );
      }
      setAssignmentDraft((prev) => ({
        ...prev,
        userIds: [],
        shiftId: '',
        note: '',
      }));
      await loadAttendance();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to assign shift'));
    } finally {
      setBusyKey('');
    }
  };

  const toggleAssignmentUser = (userId: string) => {
    setAssignmentDraft((prev) => ({
      ...prev,
      userIds: prev.userIds.includes(userId)
        ? prev.userIds.filter((value) => value !== userId)
        : [...prev.userIds, userId],
    }));
  };

  const toggleAllVisibleAssignmentUsers = () => {
    setAssignmentDraft((prev) => {
      const visibleIds = filteredAssignableUsers.map((user) => user.id);
      if (visibleIds.length === 0) return prev;
      const nextIds = allVisibleUsersSelected
        ? prev.userIds.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...prev.userIds, ...visibleIds]));
      return { ...prev, userIds: nextIds };
    });
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Workforce" />;
  }

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <div className="flex shrink-0 items-center gap-0 border-b bg-card px-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-medium transition-colors',
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

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'attendance' ? (
          <div className="space-y-4">
            <section className="surface-elevated space-y-4 p-5">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Shift schedule builder</h2>
                <p className="text-xs text-muted-foreground">Work shift records are schedule assignments. Choose one shift template, set the work date, then assign that plan to the selected employees.</p>
              </div>

              <div className="rounded-2xl border bg-background/70 p-4">
                <div className="space-y-4">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Shift template</span>
                        <select
                          value={assignmentDraft.shiftId}
                          onChange={(event) => setAssignmentDraft((prev) => ({ ...prev, shiftId: event.target.value }))}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
                        >
                          <option value="">Select shift template</option>
                          {assignableShifts.map((shift) => {
                            const display = getHrShiftDisplay(shiftsById, shift.id);
                            return (
                              <option key={shift.id} value={shift.id}>
                                {display.primary} {display.secondary ? `· ${display.secondary}` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Work date</span>
                        <input
                          type="date"
                          value={assignmentDraft.workDate}
                          onChange={(event) => {
                            setAssignmentDraft((prev) => ({ ...prev, workDate: event.target.value }));
                            setDateFilter(event.target.value);
                          }}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Shared note</span>
                        <input
                          value={assignmentDraft.note}
                          onChange={(event) => setAssignmentDraft((prev) => ({ ...prev, note: event.target.value }))}
                          placeholder="Optional note for all selected employees"
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl border bg-background p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Outlet</p>
                        <p className="mt-1 text-sm font-semibold">{currentOutletDisplay.primary}</p>
                      </div>
                      <div className="rounded-xl border bg-background p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Template</p>
                        <p className="mt-1 text-sm font-semibold">
                          {assignmentDraft.shiftId ? getHrShiftDisplay(shiftsById, assignmentDraft.shiftId).primary : 'Not selected'}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-background p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Work date</p>
                        <p className="mt-1 text-sm font-semibold">{formatDate(assignmentDraft.workDate)}</p>
                      </div>
                      <div className="rounded-xl border bg-background p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Employees</p>
                        <p className="mt-1 text-sm font-semibold">{assignmentDraft.userIds.length} selected</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Backend defaults</span>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', scheduleBadgeClass('scheduled'))}>Scheduled</span>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('pending'))}>Attendance pending</span>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', approvalBadgeClass('pending'))}>Review pending</span>
                  </div>

                  <div className="rounded-2xl border bg-background">
                    <div className="flex flex-col gap-3 border-b px-3 py-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-xs font-medium">Pick employees for this schedule</p>
                        <p className="text-[11px] text-muted-foreground">Each selected employee becomes one `work_shift` assignment for the chosen date.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{assignmentDraft.userIds.length} selected</span>
                        <button
                          onClick={toggleAllVisibleAssignmentUsers}
                          type="button"
                          className="rounded border px-2 py-1 hover:bg-accent"
                        >
                          {allVisibleUsersSelected ? 'Clear visible' : 'Select visible'}
                        </button>
                      </div>
                    </div>
                    <div className="border-b px-3 py-3">
                      <div className="relative min-w-[240px]">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={assignmentUserQuery}
                          onChange={(event) => setAssignmentUserQuery(event.target.value)}
                          placeholder="Search employee name, username, employee code"
                          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                        />
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {filteredAssignableUsers.length === 0 ? (
                        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No employees match this search</div>
                      ) : (
                        filteredAssignableUsers.map((user) => {
                          const display = getHrUserDisplay(usersById, user.id);
                          const checked = assignmentDraft.userIds.includes(user.id);
                          return (
                            <label
                              key={user.id}
                              className="flex cursor-pointer items-center justify-between gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-accent/40"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground">{display.primary}</p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {[display.secondary, currentOutletDisplay.primary].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleAssignmentUser(user.id)}
                                className="h-4 w-4 rounded border-input"
                              />
                            </label>
                          );
                        })
                      )}
                    </div>
                    <div className="flex flex-col gap-3 border-t px-3 py-3 md:flex-row md:items-center md:justify-between">
                      <p className="text-[11px] text-muted-foreground">Bulk assign uses the current single-create backend endpoint and writes one schedule record per employee.</p>
                      <button
                        onClick={() => void assignWorkShift()}
                        disabled={busyKey === 'assign-work-shift'}
                        className="h-10 rounded-md bg-primary px-4 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {busyKey === 'assign-work-shift'
                          ? 'Assigning...'
                          : assignmentDraft.userIds.length > 1
                            ? `Assign ${assignmentDraft.userIds.length} Shifts`
                            : 'Assign Shift'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {attendanceError ? <p className="text-xs text-destructive">{attendanceError}</p> : null}
            </section>

            <section className="surface-elevated space-y-4 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Scheduled roster ({attendanceTotal})</h2>
                  <p className="text-xs text-muted-foreground">Assignments for {formatDate(dateFilter)}. This table follows the persisted `work_shift` lifecycle after scheduling.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[240px] flex-1 xl:w-72 xl:flex-none">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={attendanceQuery.searchInput}
                      onChange={(event) => attendanceQuery.setSearchInput(event.target.value)}
                      placeholder="Search assignment id, employee id, note"
                      className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                    />
                  </div>
                  <select
                    value={attendanceQuery.filters.scheduleStatus || 'all'}
                    onChange={(event) => attendanceQuery.setFilter('scheduleStatus', event.target.value === 'all' ? undefined : event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="all">All schedule states</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="cancelled">Cancelled</option>
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
                    <option value="createdAt:desc">Last created</option>
                  </select>
                  <button
                    onClick={() => void loadAttendance()}
                    disabled={attendanceLoading}
                    className="flex h-8 items-center gap-1 rounded border px-2.5 text-[11px] hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', attendanceLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'Assigned', value: attendanceStats.assigned, icon: UserCheck },
                  { label: 'Scheduled', value: attendanceStats.scheduled, icon: CheckCircle2 },
                  { label: 'Attendance Pending', value: attendanceStats.pendingAttendance, icon: Clock },
                  { label: 'Review Pending', value: attendanceStats.pendingReview, icon: AlertTriangle },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-xl border bg-background/70 p-4">
                    <div className="mb-2 flex items-center gap-1.5">
                      <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</span>
                    </div>
                    <p className="text-xl font-semibold">{kpi.value}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Record', 'Employee', 'Shift', 'Schedule', 'Attendance', 'Review', 'Note', 'Actions'].map((header) => (
                        <th key={header} className="px-4 py-2.5 text-left text-[11px]">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLoading && workShifts.length === 0 ? (
                      <ListTableSkeleton columns={8} rows={6} />
                    ) : workShifts.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          No scheduled assignments found for the selected date and filters
                        </td>
                      </tr>
                    ) : workShifts.map((row) => {
                      const workShiftId = String(row.id);
                      const scheduleStatus = String(row.scheduleStatus || 'unknown').toLowerCase();
                      const attendanceStatus = String(row.attendanceStatus || 'unknown').toLowerCase();
                      const approvalStatus = String(row.approvalStatus || 'unknown').toLowerCase();
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
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', scheduleBadgeClass(scheduleStatus))}>
                              {formatHrEnumLabel(scheduleStatus)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass(attendanceStatus))}>
                              {formatHrEnumLabel(attendanceStatus)}
                            </span>
                            {(row.actualStartTime || row.actualEndTime) ? (
                              <div className="mt-1 flex flex-col text-[11px] text-muted-foreground">
                                <span>In {formatTime(row.actualStartTime)}</span>
                                <span>Out {formatTime(row.actualEndTime)}</span>
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', approvalBadgeClass(approvalStatus))}>
                              {formatHrEnumLabel(approvalStatus)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(row.note || '—')}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => void reviewWorkShift(workShiftId, 'approve', loadAttendance)}
                                disabled={!canReview || busyKey === `approve:${workShiftId}`}
                                className="h-7 rounded border px-2.5 text-[10px] hover:bg-accent disabled:opacity-50"
                              >
                                {busyKey === `approve:${workShiftId}` ? 'Approving...' : 'Approve schedule'}
                              </button>
                              <button
                                onClick={() => void reviewWorkShift(workShiftId, 'reject', loadAttendance)}
                                disabled={!canReview || busyKey === `reject:${workShiftId}`}
                                className="h-7 rounded border px-2.5 text-[10px] hover:bg-accent disabled:opacity-50"
                              >
                                {busyKey === `reject:${workShiftId}` ? 'Rejecting...' : 'Reject schedule'}
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
            </section>
          </div>
        ) : null}

        {activeTab === 'overtime' ? (
          <div className="space-y-4">
            <section className="surface-elevated space-y-4 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Overtime and exceptions ({timesheetsTotal})</h2>
                  <p className="text-xs text-muted-foreground">Read payroll timesheets by period to spot overtime load, lateness, and absence exceptions.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[240px] flex-1 xl:w-72 xl:flex-none">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={overtimeQuery.searchInput}
                      onChange={(event) => overtimeQuery.setSearchInput(event.target.value)}
                      placeholder="Search employee, outlet, payroll period"
                      className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                    />
                  </div>
                  <select
                    value={`${overtimeQuery.sortBy || 'overtimeHours'}:${overtimeQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      overtimeQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="overtimeHours:desc">Overtime ↓</option>
                    <option value="workHours:desc">Work hours ↓</option>
                    <option value="updatedAt:desc">Last updated</option>
                    <option value="payrollPeriodEndDate:desc">Latest period</option>
                  </select>
                  <button
                    onClick={() => void loadOvertime()}
                    disabled={overtimeLoading}
                    className="flex h-8 items-center gap-1 rounded border px-2.5 text-[11px] hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', overtimeLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'Overtime Hours', value: overtimeStats.totalOvertime.toFixed(2), icon: Timer },
                  { label: 'Avg OT / Employee', value: overtimeStats.avgOvertime.toFixed(2), icon: TrendingUp },
                  { label: 'Late Count', value: overtimeStats.totalLate, icon: AlertTriangle },
                  { label: 'Absent Days', value: overtimeStats.totalAbsentDays.toFixed(2), icon: UserX },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-xl border bg-background/70 p-4">
                    <div className="mb-2 flex items-center gap-1.5">
                      <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</span>
                    </div>
                    <p className="text-xl font-semibold">{kpi.value}</p>
                  </div>
                ))}
              </div>

              {overtimeError ? <p className="text-xs text-destructive">{overtimeError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Timesheet', 'Period', 'Employee', 'Outlet', 'Work', 'Overtime', 'Late', 'Absent'].map((header) => (
                        <th key={header} className={cn('px-4 py-2.5 text-[11px]', ['Late', 'Absent'].includes(header) ? 'text-right' : 'text-left')}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overtimeLoading && timesheets.length === 0 ? (
                      <ListTableSkeleton columns={8} rows={6} />
                    ) : overtimeRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          No overtime or exception rows found for the selected outlet
                        </td>
                      </tr>
                    ) : overtimeRows.map((row) => {
                      const userDisplay = getHrUserDisplay(usersById, row.userId);
                      const outletDisplay = getHrOutletDisplay(outletsById, row.outletId);
                      return (
                        <tr key={String(row.id)} className="border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{shortHrRef(row.id)}</span>
                              <span className="text-[11px] text-muted-foreground">{formatDate(row.updatedAt || row.createdAt)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {formatPeriodLabel(
                              row.payrollPeriodName,
                              row.payrollPeriodStartDate,
                              row.payrollPeriodEndDate,
                              row.payrollPeriodId,
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
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <div className="flex flex-col">
                              <span>{toNumber(row.workDays).toFixed(2)} days</span>
                              <span>{toNumber(row.workHours).toFixed(2)} hours</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">{toNumber(row.overtimeHours).toFixed(2)} hours</span>
                              <span>Rate {toNumber(row.overtimeRate).toFixed(2)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(row.lateCount)}</td>
                          <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(row.absentDays).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ListPaginationControls
                total={timesheetsTotal}
                limit={overtimeQuery.limit}
                offset={overtimeQuery.offset}
                hasMore={timesheetsHasMore}
                disabled={overtimeLoading}
                onPageChange={overtimeQuery.setPage}
                onLimitChange={overtimeQuery.setPageSize}
              />
            </section>
          </div>
        ) : null}

        {activeTab === 'leave' ? (
          <div className="space-y-4">
            <section className="surface-elevated space-y-4 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Leave requests ({leaveTotal})</h2>
                  <p className="text-xs text-muted-foreground">Use the backend leave workflow to review daily time-off requests and their approval state.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[240px] flex-1 xl:w-72 xl:flex-none">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={leaveQuery.searchInput}
                      onChange={(event) => leaveQuery.setSearchInput(event.target.value)}
                      placeholder="Search employee, shift, note"
                      className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                    />
                  </div>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(event) => setDateFilter(event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  />
                  <select
                    value={leaveQuery.filters.approvalStatus || 'all'}
                    onChange={(event) => leaveQuery.setFilter('approvalStatus', event.target.value === 'all' ? undefined : event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="all">All review states</option>
                    <option value="pending">Pending review</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select
                    value={`${leaveQuery.sortBy || 'workDate'}:${leaveQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      leaveQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="workDate:desc">Latest work date</option>
                    <option value="approvalStatus:asc">Pending first</option>
                    <option value="userId:asc">Employee A-Z</option>
                    <option value="createdAt:desc">Last created</option>
                  </select>
                  <button
                    onClick={() => void loadLeave()}
                    disabled={leaveLoading}
                    className="flex h-8 items-center gap-1 rounded border px-2.5 text-[11px] hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', leaveLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'Requests', value: leaveStats.total, icon: CalendarDays },
                  { label: 'Pending Review', value: leaveStats.pending, icon: Clock },
                  { label: 'Approved', value: leaveStats.approved, icon: CheckCircle2 },
                  { label: 'Rejected', value: leaveStats.rejected, icon: AlertTriangle },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-xl border bg-background/70 p-4">
                    <div className="mb-2 flex items-center gap-1.5">
                      <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</span>
                    </div>
                    <p className="text-xl font-semibold">{kpi.value}</p>
                  </div>
                ))}
              </div>

              {leaveError ? <p className="text-xs text-destructive">{leaveError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Request', 'Employee', 'Shift', 'Review', 'Note', 'Actions'].map((header) => (
                        <th key={header} className="px-4 py-2.5 text-left text-[11px]">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leaveLoading && leaveRequests.length === 0 ? (
                      <ListTableSkeleton columns={6} rows={6} />
                    ) : leaveRequests.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          No leave requests found for the selected date and filters
                        </td>
                      </tr>
                    ) : leaveRequests.map((row) => {
                      const workShiftId = String(row.id);
                      const approvalStatus = String(row.approvalStatus || 'unknown').toLowerCase();
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
                            <div className="flex flex-col gap-1">
                              <span className={cn('w-fit rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('leave'))}>
                                Leave
                              </span>
                              <span className={cn('w-fit rounded-full border px-2 py-0.5 text-[10px] font-medium', approvalBadgeClass(approvalStatus))}>
                                {formatHrEnumLabel(approvalStatus)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(row.note || '—')}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => void reviewWorkShift(workShiftId, 'approve', loadLeave)}
                                disabled={!canReview || busyKey === `approve:${workShiftId}`}
                                className="h-7 rounded border px-2.5 text-[10px] hover:bg-accent disabled:opacity-50"
                              >
                                {busyKey === `approve:${workShiftId}` ? 'Approving...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => void reviewWorkShift(workShiftId, 'reject', loadLeave)}
                                disabled={!canReview || busyKey === `reject:${workShiftId}`}
                                className="h-7 rounded border px-2.5 text-[10px] hover:bg-accent disabled:opacity-50"
                              >
                                {busyKey === `reject:${workShiftId}` ? 'Rejecting...' : 'Reject'}
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
                total={leaveTotal}
                limit={leaveQuery.limit}
                offset={leaveQuery.offset}
                hasMore={leaveHasMore}
                disabled={leaveLoading}
                onPageChange={leaveQuery.setPage}
                onLimitChange={leaveQuery.setPageSize}
              />
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
