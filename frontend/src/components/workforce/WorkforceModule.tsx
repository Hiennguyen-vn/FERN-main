import { useCallback, useEffect, useMemo, useState, Component, type ReactNode, type ErrorInfo } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutDashboard,
  LogIn,
  LogOut,
  RefreshCw,
  Timer,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  authApi,
  hrApi,
  type AuthUserListItem,
  type AuthUsersQuery,
  type OutletStaffView,
  type WorkShiftsQuery,
  type ShiftView,
  type WorkShiftView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import {
  formatHrEnumLabel,
  getHrUserDisplay,
} from '@/components/hr/hr-display';
import {
  computeDailyMetrics,
  computeDaySummary,
  computeRoleCoverage,
  computeUnfilledSlots,
  computeWeekCoverage,
  deriveExceptions,
  deriveLiveStatus,
  formatClockTime,
  formatShiftTime,
  getDaypart,
  getDaypartLabel,
  getLiveStatusLabel,
  getShiftProgress,
  getWorkRoleLabel,
  groupByDaypart,
  liveStatusBadgeClass,
  progressBadgeClass,
  coverageTextClass,
  isHeadcountUnconfigured,
  severityBadgeClass,
  DAYPART_ORDER,
  type DaypartGroup,
} from '@/components/workforce/daily-board';
import type { LiveStatus, DaySummary, DerivedException } from '@/types/workforce';

type WorkforceTab = 'schedule' | 'daily-board' | 'attendance' | 'review';

const TABS: { key: WorkforceTab; label: string; icon: React.ElementType }[] = [
  { key: 'daily-board', label: 'Daily Board', icon: LayoutDashboard },
  { key: 'schedule', label: 'Schedule', icon: CalendarDays },
  { key: 'attendance', label: 'Attendance', icon: Clock },
  { key: 'review', label: 'Labor Review', icon: Timer },
];

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function userDisplayName(user: AuthUserListItem): string {
  return user.fullName || user.username || `User #${user.id}`;
}

function workShiftUserName(
  assignment: WorkShiftView,
  getUserName: (id: string | null | undefined) => string,
): string {
  if (assignment.userFullName) return assignment.userFullName;
  if (assignment.userUsername) return assignment.userUsername;
  return getUserName(assignment.userId);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function getWeekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${d.getDate()}`;
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ════════════════════════════════════════════════════════════

class WorkforceErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[WorkforceModule] Render error:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-red-600 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            Something went wrong in Workforce
          </div>
          <pre className="text-xs text-red-500 bg-red-50 p-3 rounded overflow-auto whitespace-pre-wrap">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button className="text-sm text-blue-600 hover:underline" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ════════════════════════════════════════════════════════════
// MAIN MODULE
// ════════════════════════════════════════════════════════════

export function WorkforceModule() {
  return (
    <WorkforceErrorBoundary>
      <WorkforceModuleInner />
    </WorkforceErrorBoundary>
  );
}

function WorkforceModuleInner() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);

  const [activeTab, setActiveTab] = useState<WorkforceTab>('daily-board');
  const [dateFilter, setDateFilter] = useState(todayStr());
  const [weekStart, setWeekStart] = useState(() => getWeekStart(todayStr()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const [shifts, setShifts] = useState<ShiftView[]>([]);
  const [assignments, setAssignments] = useState<WorkShiftView[]>([]);
  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [knownStaff, setKnownStaff] = useState<Map<string, { id: string; fullName: string; username: string }>>(new Map());
  const [selectedTimecardId, setSelectedTimecardId] = useState<string | null>(null);

  // ── Data loading ──

  const loadData = useCallback(async () => {
    if (!token || !outletId) return;
    setLoading(true);
    setError('');
    try {
      const [shiftsData, outletStaffData, usersData] = await Promise.all([
        hrApi.shifts(token, outletId),
        hrApi.outletStaff(token, outletId).catch(() => [] as OutletStaffView[]),
        collectPagedItems<AuthUserListItem, AuthUsersQuery>(
          (query) => authApi.users(token, query),
          { sortBy: 'username', sortDir: 'asc' as const },
          200,
        ).catch(() => [] as AuthUserListItem[]),
      ]);
      setShifts(shiftsData);
      setUsers(usersData);
      if (outletStaffData.length > 0) {
        setKnownStaff((prev) => {
          const next = new Map(prev);
          for (const s of outletStaffData) {
            if (s.id) next.set(s.id, { id: s.id, fullName: s.fullName || s.username || '', username: s.username || '' });
          }
          return next;
        });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token, outletId]);

  const loadAssignments = useCallback(async (startDate: string, endDate: string) => {
    if (!token || !outletId) return;
    try {
      const data = await collectPagedItems<WorkShiftView, WorkShiftsQuery>(
        (query) => hrApi.workShiftsPaged(token, query),
        { outletId, startDate, endDate, sortBy: 'workDate', sortDir: 'asc' as const },
        200,
      );
      setAssignments(data);
      setKnownStaff((prev) => {
        const next = new Map(prev);
        for (const a of data) {
          if (a.userId && (a.userFullName || a.userUsername)) {
            next.set(String(a.userId), {
              id: String(a.userId),
              fullName: a.userFullName || a.userUsername || '',
              username: a.userUsername || '',
            });
          }
        }
        return next;
      });
    } catch (err) {
      toast.error('Failed to load assignments: ' + getErrorMessage(err));
    }
  }, [token, outletId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (activeTab === 'daily-board' || activeTab === 'attendance') {
      loadAssignments(dateFilter, dateFilter);
    } else {
      const weekEnd = addDays(weekStart, 6);
      loadAssignments(weekStart, weekEnd);
    }
  }, [activeTab, dateFilter, weekStart, loadAssignments]);

  const userMap = useMemo(() => new Map(users.map((u) => [String(u.id), u])), [users]);

  const getUserName = useCallback(
    (userId: string | null | undefined) => {
      const key = String(userId ?? '').trim();
      if (!key) return '—';
      const fromApi = getHrUserDisplay(userMap, userId);
      if (fromApi.primary !== `User ${key}`) return fromApi.primary;
      const known = knownStaff.get(key);
      if (known) return known.fullName || known.username || `#${key.slice(-6)}`;
      return `#${key.slice(-6)}`;
    },
    [userMap, knownStaff],
  );

  // Effective users for dropdowns — API list preferred, fallback to knownStaff
  const effectiveUsers = useMemo<AuthUserListItem[]>(() => {
    if (users.length > 0) return users;
    return [...knownStaff.values()].map((s): AuthUserListItem => ({
      id: s.id,
      username: s.username,
      fullName: s.fullName,
      employeeCode: null,
      email: null,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    }));
  }, [users, knownStaff]);

  const refresh = useCallback(() => {
    loadData();
    if (activeTab === 'daily-board' || activeTab === 'attendance') {
      loadAssignments(dateFilter, dateFilter);
    } else {
      loadAssignments(weekStart, addDays(weekStart, 6));
    }
  }, [loadData, loadAssignments, activeTab, dateFilter, weekStart]);

  // ── Actions ──

  const doUpdateAttendance = useCallback(async (workShiftId: string, payload: Record<string, unknown>) => {
    if (!token || busyKey) return;
    setBusyKey(workShiftId);
    try {
      await hrApi.updateAttendance(token, workShiftId, payload);
      toast.success('Attendance updated');
      refresh();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyKey('');
    }
  }, [token, busyKey, refresh]);

  const doApprove = useCallback(async (workShiftId: string) => {
    if (!token || busyKey) return;
    setBusyKey(workShiftId);
    try {
      await hrApi.approveWorkShift(token, workShiftId);
      toast.success('Shift approved');
      refresh();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyKey('');
    }
  }, [token, busyKey, refresh]);

  const doReject = useCallback(async (workShiftId: string, reason?: string) => {
    if (!token || busyKey) return;
    setBusyKey(workShiftId);
    try {
      await hrApi.rejectWorkShift(token, workShiftId, { reason });
      toast.success('Shift rejected');
      refresh();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyKey('');
    }
  }, [token, busyKey, refresh]);

  const doCreateAssignment = useCallback(async (shiftId: string, userId: string, workDate: string, workRole?: string) => {
    if (!token || busyKey) return;
    setBusyKey('assign');
    try {
      await hrApi.createWorkShift(token, { shiftId, userId, workDate, workRole });
      toast.success('Staff assigned');
      refresh();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyKey('');
    }
  }, [token, busyKey, refresh]);

  // ── Render ──

  if (!outletId) {
    return <EmptyState title="Select an outlet" description="Choose an outlet from the sidebar to manage workforce." />;
  }
  if (error && !shifts.length) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Workforce" />;
  }

  return (
    <div className="space-y-4 p-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors',
              activeTab === tab.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
        <div className="ml-auto">
          <button onClick={refresh} disabled={loading} className="p-1.5 rounded hover:bg-muted" title="Refresh">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {activeTab === 'daily-board' && (
        <DailyBoardTab
          shifts={shifts}
          assignments={assignments}
          date={dateFilter}
          onDateChange={setDateFilter}
          getUserName={getUserName}
          users={effectiveUsers}
          busyKey={busyKey}
          onUpdateAttendance={doUpdateAttendance}
          onApprove={doApprove}
          onReject={doReject}
          onAssign={doCreateAssignment}
        />
      )}
      {activeTab === 'schedule' && (
        <SchedulePlannerTab
          shifts={shifts}
          assignments={assignments}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          getUserName={getUserName}
          users={effectiveUsers}
          busyKey={busyKey}
          onAssign={doCreateAssignment}
        />
      )}
      {activeTab === 'attendance' && (
        <AttendanceTab
          shifts={shifts}
          assignments={assignments}
          date={dateFilter}
          onDateChange={setDateFilter}
          getUserName={getUserName}
          selectedId={selectedTimecardId}
          onSelectId={setSelectedTimecardId}
          busyKey={busyKey}
          onUpdateAttendance={doUpdateAttendance}
          onApprove={doApprove}
          onReject={doReject}
        />
      )}
      {activeTab === 'review' && (
        <LaborReviewTab
          shifts={shifts}
          assignments={assignments}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          getUserName={getUserName}
          busyKey={busyKey}
          onApprove={doApprove}
          onReject={doReject}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// DAILY BOARD TAB
// ════════════════════════════════════════════════════════════

function DailyBoardTab({
  shifts, assignments, date, onDateChange, getUserName, users, busyKey,
  onUpdateAttendance, onApprove, onReject, onAssign,
}: {
  shifts: ShiftView[];
  assignments: WorkShiftView[];
  date: string;
  onDateChange: (d: string) => void;
  getUserName: (id: string | null | undefined) => string;
  users: AuthUserListItem[];
  busyKey: string;
  onUpdateAttendance: (id: string, payload: Record<string, unknown>) => void;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
  onAssign: (shiftId: string, userId: string, workDate: string, workRole?: string) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const metrics = useMemo(() => computeDailyMetrics(shifts, assignments, date, now), [shifts, assignments, date, now]);
  const daypartGroups = useMemo(() => groupByDaypart(shifts, assignments, date, now), [shifts, assignments, date, now]);
  const exceptions = useMemo(() => deriveExceptions(shifts, assignments, date, now), [shifts, assignments, date, now]);

  const [assignModal, setAssignModal] = useState<{ shiftId: string; workRole: string } | null>(null);

  return (
    <div className="space-y-4">
      {/* Date nav */}
      <div className="flex items-center gap-2">
        <button onClick={() => onDateChange(addDays(date, -1))} className="p-1.5 rounded hover:bg-muted border">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold">{formatDateFull(date)}</h2>
        <button onClick={() => onDateChange(addDays(date, 1))} className="p-1.5 rounded hover:bg-muted border">
          <ChevronRight className="h-4 w-4" />
        </button>
        {date !== todayStr() && (
          <button onClick={() => onDateChange(todayStr())} className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50">
            Today
          </button>
        )}
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-5 gap-3">
        <MetricCard label="On Floor" value={`${metrics.onFloor}/${metrics.totalAssigned}`} variant={metrics.onFloor < metrics.totalAssigned ? 'warning' : 'default'} />
        <MetricCard label="Coverage" value={`${metrics.coveragePercent}%`} variant={metrics.coveragePercent < 80 ? 'warning' : 'default'} />
        <MetricCard label="Late" value={String(metrics.lateCount)} variant={metrics.lateCount > 0 ? 'warning' : 'default'} />
        <MetricCard label="No-Show" value={String(metrics.noShowCount)} variant={metrics.noShowCount > 0 ? 'danger' : 'default'} />
        <MetricCard label="Pending Review" value={String(metrics.pendingReview)} variant={metrics.pendingReview > 0 ? 'info' : 'default'} />
      </div>

      {/* Exceptions alert */}
      {exceptions.filter((e) => e.type !== 'unfilled').length > 0 && (
        <div className="border border-amber-200 rounded-lg bg-amber-50 p-3 space-y-1.5">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            Alerts ({exceptions.filter((e) => e.type !== 'unfilled').length})
          </h3>
          {exceptions.filter((e) => e.type !== 'unfilled').map((ex, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium shrink-0', severityBadgeClass(ex.severity))}>
                {ex.type === 'no_show' ? 'NO-SHOW' : 'LATE'}
              </span>
              <span className="font-medium truncate">
                {ex.employeeName ?? (ex.employeeId ? getUserName(ex.employeeId) : '—')}
              </span>
              <span className="text-muted-foreground text-xs truncate">
                {ex.shiftName}{ex.workRole ? ` · ${getWorkRoleLabel(ex.workRole)}` : ''}
              </span>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">{ex.detail}</span>
              {ex.type === 'no_show' && ex.workShiftId && (
                <button
                  onClick={() => onUpdateAttendance(ex.workShiftId!, { attendanceStatus: 'absent' })}
                  disabled={!!busyKey}
                  className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-0.5 rounded shrink-0 disabled:opacity-50"
                >
                  Mark Absent
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Daypart sections */}
      {daypartGroups.length === 0 && (
        <EmptyState title="No shifts today" description="No shifts are configured for this outlet on this date." />
      )}
      {daypartGroups.map((group) => (
        <DaypartSection
          key={group.daypart}
          group={group}
          date={date}
          now={now}
          getUserName={getUserName}
          busyKey={busyKey}
          onUpdateAttendance={onUpdateAttendance}
          onApprove={onApprove}
          onReject={onReject}
          onAssignClick={(shiftId, workRole) => setAssignModal({ shiftId, workRole })}
        />
      ))}

      {/* Quick assign modal */}
      {assignModal && (
        <QuickAssignModal
          users={users}
          shiftId={assignModal.shiftId}
          workRole={assignModal.workRole}
          date={date}
          busyKey={busyKey}
          assignedUserIds={assignments
            .filter((a) => String(a.shiftId ?? '') === assignModal.shiftId && a.workDate === date)
            .map((a) => String(a.userId ?? ''))}
          onAssign={(userId) => {
            onAssign(assignModal.shiftId, userId, date, assignModal.workRole || undefined);
            setAssignModal(null);
          }}
          onClose={() => setAssignModal(null)}
        />
      )}
    </div>
  );
}

// ── Daypart section ──

function DaypartSection({
  group, date, now, getUserName, busyKey,
  onUpdateAttendance, onApprove, onReject, onAssignClick,
}: {
  group: DaypartGroup;
  date: string;
  now: Date;
  getUserName: (id: string | null | undefined) => string;
  busyKey: string;
  onUpdateAttendance: (id: string, payload: Record<string, unknown>) => void;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
  onAssignClick: (shiftId: string, workRole: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const allProgress = group.shifts.map((s) => s.progress);
  const overallProgress = allProgress.every((p) => p === 'completed')
    ? 'completed'
    : allProgress.some((p) => p === 'in_progress')
      ? 'in_progress'
      : 'not_started';

  const totalRequired = group.shifts.reduce((sum, s) => sum + (Number(s.shift.headcountRequired) || 1), 0);
  const totalAssigned = group.shifts.reduce((sum, s) => {
    return sum + s.assignments.filter((a) => String(a.scheduleStatus ?? '').trim() !== 'cancelled').length;
  }, 0);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors bg-muted/20"
      >
        {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        <span className="font-semibold text-sm">{group.label}</span>
        <span className="text-xs text-muted-foreground">
          {group.shifts.map((s) => `${formatShiftTime(s.shift.startTime)}–${formatShiftTime(s.shift.endTime)}`).join(' · ')}
        </span>
        <span className={cn('text-xs font-medium ml-2 px-1.5 py-0.5 rounded', coverageTextClass(totalAssigned, totalRequired))}>
          {totalAssigned} staff
        </span>
        <span className={cn('ml-auto text-xs px-2 py-0.5 rounded font-medium', progressBadgeClass(overallProgress))}>
          {overallProgress === 'completed' ? '✓ Done' : overallProgress === 'in_progress' ? '● In Progress' : '○ Not Started'}
        </span>
      </button>

      {!collapsed && (
        <div className="divide-y">
          {group.shifts.map(({ shift, assignments: shiftAssignments, roleCoverage, unfilled }) => (
            <div key={shift.id} className="px-3 py-2 space-y-2">
              {/* Shift header */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">{shift.name}</span>
                <span className="text-xs text-muted-foreground">{formatShiftTime(shift.startTime)}–{formatShiftTime(shift.endTime)}</span>
                {roleCoverage.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 ml-2">
                    {roleCoverage.map((rc) => (
                      <span key={rc.workRole} className={cn('text-xs font-medium px-1.5 py-0.5 rounded', coverageTextClass(rc.assigned, rc.required))}>
                        {getWorkRoleLabel(rc.workRole)} {rc.checkedIn}/{rc.required}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Assignment cards */}
              {shiftAssignments
                .filter((a) => String(a.scheduleStatus ?? '').trim() !== 'cancelled')
                .map((a) => {
                  const liveStatus = deriveLiveStatus(a, shift, date, now);
                  const isPending = String(a.approvalStatus ?? '').trim() === 'pending';
                  const isApproved = String(a.approvalStatus ?? '').trim() === 'approved';
                  return (
                    <div key={a.id} className={cn(
                      'flex items-center gap-2 py-2 px-2.5 rounded-md text-sm border',
                      liveStatus === 'no_show' && 'border-red-200 bg-red-50/50',
                      liveStatus === 'late' && 'border-amber-200 bg-amber-50/50',
                      liveStatus === 'checked_in' && 'border-green-200 bg-green-50/30',
                      liveStatus === 'completed' && 'border-gray-200 bg-gray-50/30',
                      !['no_show', 'late', 'checked_in', 'completed'].includes(liveStatus) && 'border-muted bg-background',
                    )}>
                      <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium shrink-0', liveStatusBadgeClass(liveStatus))}>
                        {getLiveStatusLabel(liveStatus)}
                      </span>
                      <span className="font-medium truncate">{workShiftUserName(a, getUserName)}</span>
                      {a.workRole && (
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                          {getWorkRoleLabel(a.workRole)}
                        </span>
                      )}
                      {a.actualStartTime && (
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                          {formatClockTime(a.actualStartTime)}
                          {a.actualEndTime ? ` → ${formatClockTime(a.actualEndTime)}` : ' →…'}
                        </span>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 ml-auto shrink-0">
                        {/* Clock In */}
                        {!a.actualStartTime && liveStatus !== 'on_leave' && liveStatus !== 'no_show' && (
                          <button
                            onClick={() => onUpdateAttendance(a.id, { attendanceStatus: 'present', actualStartTime: new Date().toISOString() })}
                            disabled={!!busyKey}
                            title="Record Clock In"
                            className="flex items-center gap-1 text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            <LogIn className="h-3 w-3" /> In
                          </button>
                        )}
                        {/* Clock Out */}
                        {a.actualStartTime && !a.actualEndTime && (
                          <button
                            onClick={() => onUpdateAttendance(a.id, { actualEndTime: new Date().toISOString() })}
                            disabled={!!busyKey}
                            title="Record Clock Out"
                            className="flex items-center gap-1 text-xs bg-slate-600 text-white px-2 py-1 rounded hover:bg-slate-700 disabled:opacity-50"
                          >
                            <LogOut className="h-3 w-3" /> Out
                          </button>
                        )}
                        {/* Mark absent */}
                        {liveStatus === 'no_show' && (
                          <button
                            onClick={() => onUpdateAttendance(a.id, { attendanceStatus: 'absent' })}
                            disabled={!!busyKey}
                            className="text-xs border border-red-300 text-red-600 hover:bg-red-50 px-2 py-1 rounded disabled:opacity-50"
                          >
                            Absent
                          </button>
                        )}
                        {/* Approve */}
                        {isPending && a.actualEndTime && (
                          <button
                            onClick={() => onApprove(a.id)}
                            disabled={!!busyKey}
                            title="Approve hours"
                            className="flex items-center gap-1 text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:bg-primary/90 disabled:opacity-50"
                          >
                            <UserCheck className="h-3 w-3" /> Approve
                          </button>
                        )}
                        {isApproved && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                      </div>
                    </div>
                  );
                })}

              {/* Unfilled slots */}
              {unfilled.map((slot, i) => (
                <div key={`unfilled-${shift.id}-${slot.workRole}-${i}`}
                  className="flex items-center gap-2 py-1.5 px-2.5 rounded-md border border-dashed border-amber-300 bg-amber-50/30 text-sm">
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">OPEN</span>
                  <span className="text-muted-foreground text-xs">
                    {getWorkRoleLabel(slot.workRole)} — {slot.gap} slot{slot.gap > 1 ? 's' : ''} needed
                  </span>
                  <button
                    onClick={() => onAssignClick(shift.id, slot.workRole)}
                    className="ml-auto text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 px-2 py-0.5 rounded"
                  >
                    + Assign
                  </button>
                </div>
              ))}

              {/* Add staff button when no role requirements configured */}
              {unfilled.length === 0 && roleCoverage.length === 0 && (
                <button
                  onClick={() => onAssignClick(shift.id, '')}
                  className="text-xs text-muted-foreground hover:text-foreground border border-dashed rounded px-2 py-1 w-full text-center hover:border-foreground/30 transition-colors"
                >
                  + Add staff to this shift
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// SCHEDULE PLANNER TAB
// ════════════════════════════════════════════════════════════

function SchedulePlannerTab({
  shifts, assignments, weekStart, onWeekChange, getUserName, users, busyKey, onAssign,
}: {
  shifts: ShiftView[];
  assignments: WorkShiftView[];
  weekStart: string;
  onWeekChange: (ws: string) => void;
  getUserName: (id: string | null | undefined) => string;
  users: AuthUserListItem[];
  busyKey: string;
  onAssign: (shiftId: string, userId: string, workDate: string, workRole?: string) => void;
}) {
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const [selectedCell, setSelectedCell] = useState<{ shiftId: string; date: string } | null>(null);

  const shiftsByDaypart = useMemo(() => {
    const groups = new Map<string, ShiftView[]>();
    for (const dp of DAYPART_ORDER) groups.set(dp, []);
    for (const shift of [...shifts].sort((a, b) => String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')))) {
      const dp = getDaypart(shift);
      const arr = groups.get(dp) ?? [];
      arr.push(shift);
      groups.set(dp, arr);
    }
    return [...groups.entries()].filter(([, arr]) => arr.length > 0);
  }, [shifts]);

  const totalAssigned = weekDates.reduce((sum, d) => {
    return sum + assignments.filter((a) => a.workDate === d && String(a.scheduleStatus ?? '').trim() !== 'cancelled').length;
  }, 0);
  const configuredShifts = shifts.filter((s) => (Number(s.headcountRequired) || 1) > 1);
  const hasConfiguredHeadcount = configuredShifts.length > 0;
  const totalRequired = hasConfiguredHeadcount
    ? weekDates.reduce((sum, d) => {
        return sum + configuredShifts.reduce((s2, shift) => s2 + (Number(shift.headcountRequired) || 1), 0);
      }, 0)
    : 0;
  const totalGaps = Math.max(0, totalRequired - totalAssigned);

  return (
    <div className="space-y-4">
      {/* Week nav */}
      <div className="flex items-center gap-2">
        <button onClick={() => onWeekChange(addDays(weekStart, -7))} className="p-1.5 rounded hover:bg-muted border">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold">Week of {formatDateFull(weekStart)}</h2>
        <button onClick={() => onWeekChange(addDays(weekStart, 7))} className="p-1.5 rounded hover:bg-muted border">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => onWeekChange(getWeekStart(todayStr()))}
          className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50"
        >
          This Week
        </button>
      </div>

      <div className="text-sm text-muted-foreground">
        {hasConfiguredHeadcount
          ? <>Assigned: {totalAssigned}/{totalRequired} · Gaps: {totalGaps > 0 ? <span className="text-amber-600 font-medium">{totalGaps}</span> : <span className="text-green-600">0</span>}</>
          : <>Total assignments this week: <span className="font-medium text-foreground">{totalAssigned}</span></>
        }
        <span className="ml-2 text-xs text-muted-foreground/70">· Click a cell to assign staff</span>
      </div>

      {/* Week grid */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/30">
              <th className="text-left p-3 border-b w-40 text-xs font-medium text-muted-foreground">Ca làm việc</th>
              {weekDates.map((d) => {
                const dayLabel = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                const dayNum = new Date(d + 'T00:00:00').getDate();
                const monthShort = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' });
                return (
                  <th key={d} className={cn(
                    'text-center p-2 border-b text-xs font-medium min-w-[120px]',
                    d === todayStr() ? 'bg-blue-50 text-blue-700' : 'text-muted-foreground',
                  )}>
                    <div className="font-semibold">{dayLabel}</div>
                    <div className={cn('text-[10px] font-normal mt-0.5', d === todayStr() ? 'text-blue-600' : 'text-muted-foreground/70')}>
                      {dayNum} {monthShort}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shiftsByDaypart.length === 0 && (
              <tr><td colSpan={8} className="text-center p-8 text-muted-foreground text-sm">No shifts configured</td></tr>
            )}
            {shiftsByDaypart.map(([daypart, dpShifts]) => (
              dpShifts.map((shift) => {
                const isSelected = selectedCell?.shiftId === shift.id;
                return (
                  <tr key={shift.id} className={cn(isSelected && 'bg-primary/5')}>
                    <td className="p-3 border-b border-r align-top bg-muted/10">
                      <div className="font-semibold text-xs text-foreground leading-tight">{shift.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {formatShiftTime(shift.startTime)}–{formatShiftTime(shift.endTime)}
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 mt-0.5 uppercase tracking-wide">{getDaypartLabel(daypart as any)}</div>
                    </td>
                    {weekDates.map((d) => {
                      const cellAssignments = assignments.filter(
                        (a) => String(a.shiftId ?? '') === shift.id && a.workDate === d && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
                      );
                      const cov = computeWeekCoverage(shift, assignments, d);
                      const isCellSelected = selectedCell?.shiftId === shift.id && selectedCell?.date === d;
                      const isToday = d === todayStr();
                      return (
                        <td
                          key={d}
                          onClick={() => setSelectedCell(isCellSelected ? null : { shiftId: shift.id, date: d })}
                          className={cn(
                            'p-1.5 border-b align-top cursor-pointer transition-colors select-none',
                            isToday && 'bg-blue-50/30',
                            isCellSelected && 'ring-2 ring-inset ring-primary bg-primary/5',
                            !isCellSelected && !isToday && 'hover:bg-muted/20',
                          )}
                        >
                          <div className="space-y-1 min-h-[40px]">
                            {cellAssignments.map((a) => {
                              const name = workShiftUserName(a, getUserName);
                              const role = a.workRole ? getWorkRoleLabel(a.workRole) : null;
                              const hasActualTime = !!a.actualStartTime;
                              const checkIn = hasActualTime ? formatClockTime(a.actualStartTime) : null;
                              const checkOut = a.actualEndTime ? formatClockTime(a.actualEndTime) : null;
                              const attStatus = String(a.attendanceStatus ?? '').toLowerCase();
                              const isLate = attStatus === 'late';
                              const isAbsent = attStatus === 'absent';
                              const isPresent = attStatus === 'present' || hasActualTime;
                              return (
                                <div
                                  key={a.id}
                                  className={cn(
                                    'rounded px-1.5 py-1 text-[11px] leading-tight',
                                    isAbsent && 'bg-red-100 text-red-800',
                                    isLate && 'bg-amber-100 text-amber-800',
                                    isPresent && !isLate && !isAbsent && 'bg-green-100 text-green-800',
                                    !isPresent && !isLate && !isAbsent && 'bg-gray-100 text-gray-700',
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-medium truncate max-w-[80px]">{name}</span>
                                    {role && (
                                      <span className="text-[9px] font-semibold uppercase opacity-70 shrink-0">{role}</span>
                                    )}
                                  </div>
                                  {(checkIn || checkOut) && (
                                    <div className="text-[10px] opacity-75 mt-0.5">
                                      {checkIn}{checkOut ? ` - ${checkOut}` : ''}
                                    </div>
                                  )}
                                  {isLate && (
                                    <div className="text-[9px] mt-0.5">⚠ Late</div>
                                  )}
                                </div>
                              );
                            })}
                            {cellAssignments.length === 0 && (
                              <div className="text-[10px] text-muted-foreground/40 pt-1 text-center">—</div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ))}
          </tbody>
        </table>
      </div>

      {/* Assign modal — centered overlay */}
      {selectedCell && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setSelectedCell(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <ScheduleCellDetail
              shift={shifts.find((s) => s.id === selectedCell.shiftId)!}
              date={selectedCell.date}
              assignments={assignments}
              getUserName={getUserName}
              users={users}
              busyKey={busyKey}
              onAssign={onAssign}
              onClose={() => setSelectedCell(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleCellDetail({
  shift, date, assignments, getUserName, users, busyKey, onAssign, onClose,
}: {
  shift: ShiftView;
  date: string;
  assignments: WorkShiftView[];
  getUserName: (id: string | null | undefined) => string;
  users: AuthUserListItem[];
  busyKey: string;
  onAssign: (shiftId: string, userId: string, workDate: string, workRole?: string) => void;
  onClose: () => void;
}) {
  const [assignRole, setAssignRole] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [search, setSearch] = useState('');

  if (!shift) return null;

  const cellAssignments = assignments.filter(
    (a) => String(a.shiftId ?? '') === shift.id && a.workDate === date && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
  );
  const roles = shift.roleRequirements ?? [];
  const assignedUserIds = new Set(cellAssignments.map((a) => String(a.userId ?? '')));

  const filteredUsers = users.filter((u) => {
    if (assignedUserIds.has(String(u.id))) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return userDisplayName(u).toLowerCase().includes(q);
  });

  return (
    <div className="w-[640px] max-h-[85vh] flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between bg-muted/20 px-4 py-3 border-b shrink-0">
        <div>
          <h3 className="font-semibold text-sm">{shift.name}</h3>
          <div className="text-xs text-muted-foreground">
            {formatDateFull(date)} · {formatShiftTime(shift.startTime)}–{formatShiftTime(shift.endTime)}
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto">
        {/* Left: assigned staff */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Assigned ({cellAssignments.length})
          </div>

          {roles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {roles.map((req) => {
                const assigned = cellAssignments.filter((a) => String(a.workRole ?? '').trim() === req.workRole).length;
                return (
                  <span key={req.workRole} className={cn('text-xs font-medium px-1.5 py-0.5 rounded', coverageTextClass(assigned, req.requiredCount))}>
                    {getWorkRoleLabel(req.workRole)}: {assigned}/{req.requiredCount}
                  </span>
                );
              })}
            </div>
          )}

          {cellAssignments.length === 0 && (
            <div className="text-xs text-muted-foreground py-2">No staff assigned for this day</div>
          )}
          {cellAssignments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded bg-muted/30">
              <span className="font-medium truncate">{workShiftUserName(a, getUserName)}</span>
              {a.workRole && (
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded ml-auto shrink-0">
                  {getWorkRoleLabel(a.workRole)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Right: assign form */}
        <div className="space-y-2 border-l pl-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Staff</div>
          <input
            type="text"
            placeholder="Search staff..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-sm"
          />
          <div className="max-h-36 overflow-y-auto space-y-0.5 border rounded">
            {filteredUsers.length === 0 && (
              <div className="text-xs text-muted-foreground p-2">
                {users.length === 0 ? 'No staff data available' : 'No unassigned staff found'}
              </div>
            )}
            {filteredUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => setAssignUserId(String(u.id))}
                className={cn(
                  'w-full text-left px-2 py-1.5 text-sm hover:bg-muted transition-colors',
                  String(u.id) === assignUserId && 'bg-primary/10 font-medium',
                )}
              >
                {userDisplayName(u)}
              </button>
            ))}
          </div>
          {roles.length > 0 ? (
            <select
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
              className="w-full text-sm border rounded px-2 py-1.5"
            >
              <option value="">Work role (optional)...</option>
              {roles.map((req) => (
                <option key={req.workRole} value={req.workRole}>{getWorkRoleLabel(req.workRole)}</option>
              ))}
            </select>
          ) : (
            <select
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
              className="w-full text-sm border rounded px-2 py-1.5"
            >
              <option value="">Work role (optional)...</option>
              <option value="cashier">Cashier</option>
              <option value="kitchen_staff">Kitchen</option>
              <option value="prep">Prep</option>
              <option value="support">Support</option>
              <option value="closing_support">Closing</option>
            </select>
          )}
          <button
            onClick={() => {
              if (assignUserId) {
                onAssign(shift.id, assignUserId, date, assignRole || undefined);
                setAssignUserId('');
                setAssignRole('');
                setSearch('');
              }
            }}
            disabled={!assignUserId || !!busyKey}
            className="w-full text-sm bg-primary text-primary-foreground py-1.5 rounded disabled:opacity-50 hover:bg-primary/90 font-medium"
          >
            {busyKey === 'assign' ? 'Assigning…' : 'Confirm Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ════════════════════════════════════════════════════════════

function AttendanceTab({
  shifts, assignments, date, onDateChange, getUserName, selectedId, onSelectId,
  busyKey, onUpdateAttendance, onApprove, onReject,
}: {
  shifts: ShiftView[];
  assignments: WorkShiftView[];
  date: string;
  onDateChange: (d: string) => void;
  getUserName: (id: string | null | undefined) => string;
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  busyKey: string;
  onUpdateAttendance: (id: string, payload: Record<string, unknown>) => void;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  const sorted = useMemo(() => {
    return [...assignments]
      .filter((a) => String(a.scheduleStatus ?? '').trim() !== 'cancelled')
      .sort((a, b) => {
        const shiftA = shiftMap.get(String(a.shiftId ?? ''));
        const shiftB = shiftMap.get(String(b.shiftId ?? ''));
        const statusA = shiftA ? deriveLiveStatus(a, shiftA, date, now) : 'assigned';
        const statusB = shiftB ? deriveLiveStatus(b, shiftB, date, now) : 'assigned';
        const exOrder: Record<string, number> = { no_show: 0, late: 1, checked_in: 2, on_leave: 3, assigned: 4, confirmed: 4, completed: 5, cancelled: 6 };
        return (exOrder[statusA] ?? 4) - (exOrder[statusB] ?? 4);
      });
  }, [assignments, shiftMap, date, now]);

  const effectiveSelected = selectedId ? assignments.find((a) => a.id === selectedId) : sorted[0];
  const selectedShift = effectiveSelected ? shiftMap.get(String(effectiveSelected.shiftId ?? '')) : undefined;

  return (
    <div className="space-y-3">
      {/* Date nav */}
      <div className="flex items-center gap-2">
        <button onClick={() => onDateChange(addDays(date, -1))} className="p-1.5 rounded hover:bg-muted border">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold">{formatDateFull(date)}</h2>
        <button onClick={() => onDateChange(addDays(date, 1))} className="p-1.5 rounded hover:bg-muted border">
          <ChevronRight className="h-4 w-4" />
        </button>
        {date !== todayStr() && (
          <button onClick={() => onDateChange(todayStr())} className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50">
            Today
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No timecards" description="No staff scheduled for this date." />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {/* Timecard list */}
          <div className="col-span-1 space-y-0.5 border rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 border-b">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Timecards ({sorted.length})</span>
            </div>
            <div className="max-h-[560px] overflow-y-auto divide-y">
              {sorted.map((a) => {
                const shift = shiftMap.get(String(a.shiftId ?? ''));
                const liveStatus = shift ? deriveLiveStatus(a, shift, date, now) : ('assigned' as LiveStatus);
                const isSelected = a.id === (effectiveSelected?.id ?? sorted[0]?.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => onSelectId(a.id)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 text-sm transition-colors',
                      isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-muted/40',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('w-2 h-2 rounded-full shrink-0', {
                        'bg-green-500': liveStatus === 'checked_in',
                        'bg-amber-500': liveStatus === 'late',
                        'bg-red-500': liveStatus === 'no_show',
                        'bg-slate-400': liveStatus === 'completed' || liveStatus === 'assigned' || liveStatus === 'confirmed',
                        'bg-blue-400': liveStatus === 'on_leave',
                      })} />
                      <span className="font-medium truncate">{workShiftUserName(a, getUserName)}</span>
                      {String(a.approvalStatus ?? '').trim() === 'approved' && (
                        <CheckCircle2 className="h-3 w-3 text-green-600 ml-auto shrink-0" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 ml-4 flex items-center gap-1.5 flex-wrap">
                      {shift && <span>{formatShiftTime(shift.startTime)}–{formatShiftTime(shift.endTime)}</span>}
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', liveStatusBadgeClass(liveStatus))}>
                        {getLiveStatusLabel(liveStatus)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail panel */}
          <div className="col-span-2 border rounded-lg overflow-hidden">
            {effectiveSelected && selectedShift ? (
              <TimecardDetail
                assignment={effectiveSelected}
                shift={selectedShift}
                date={date}
                now={now}
                getUserName={getUserName}
                busyKey={busyKey}
                onUpdateAttendance={onUpdateAttendance}
                onApprove={onApprove}
                onReject={onReject}
              />
            ) : (
              <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                Select a timecard to view details
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TimecardDetail({
  assignment, shift, date, now, getUserName, busyKey, onUpdateAttendance, onApprove, onReject,
}: {
  assignment: WorkShiftView;
  shift: ShiftView;
  date: string;
  now: Date;
  getUserName: (id: string | null | undefined) => string;
  busyKey: string;
  onUpdateAttendance: (id: string, payload: Record<string, unknown>) => void;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  const liveStatus = deriveLiveStatus(assignment, shift, date, now);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const scheduledHours = (() => {
    const s = String(shift.startTime ?? '').trim();
    const e = String(shift.endTime ?? '').trim();
    if (!s || !e) return 0;
    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    return Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
  })();

  const actualHours = (() => {
    if (!assignment.actualStartTime) return 0;
    const start = new Date(assignment.actualStartTime);
    const end = assignment.actualEndTime ? new Date(assignment.actualEndTime) : now;
    return Math.max(0, (end.getTime() - start.getTime()) / 3600000);
  })();

  const isPending = String(assignment.approvalStatus ?? '').trim() === 'pending';
  const isApproved = String(assignment.approvalStatus ?? '').trim() === 'approved';
  const isRejected = String(assignment.approvalStatus ?? '').trim() === 'rejected';
  const hasClockOut = !!assignment.actualEndTime;
  const hasClockIn = !!assignment.actualStartTime;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between bg-muted/20 px-4 py-3 border-b">
        <div>
          <h3 className="font-semibold text-base">{workShiftUserName(assignment, getUserName)}</h3>
          <div className="text-xs text-muted-foreground mt-0.5">
            {shift.name} · {formatShiftTime(shift.startTime)}–{formatShiftTime(shift.endTime)}
            {assignment.workRole && <> · {getWorkRoleLabel(assignment.workRole)}</>}
          </div>
        </div>
        <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', liveStatusBadgeClass(liveStatus))}>
          {getLiveStatusLabel(liveStatus)}
        </span>
      </div>

      {/* Info grid */}
      <div className="px-4 py-3 flex-1">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="text-muted-foreground">Scheduled</div>
          <div className="font-medium">
            {formatShiftTime(shift.startTime)} — {formatShiftTime(shift.endTime)}
            <span className="text-muted-foreground ml-1">({scheduledHours.toFixed(1)}h)</span>
          </div>

          <div className="text-muted-foreground">Clock In</div>
          <div className={cn('font-medium', !hasClockIn && 'text-muted-foreground italic')}>
            {hasClockIn ? formatClockTime(assignment.actualStartTime) : 'Not recorded'}
          </div>

          <div className="text-muted-foreground">Clock Out</div>
          <div className={cn('font-medium', !hasClockOut && 'text-muted-foreground italic')}>
            {hasClockOut ? formatClockTime(assignment.actualEndTime) : hasClockIn ? 'Still on floor' : 'Not recorded'}
          </div>

          <div className="text-muted-foreground">Actual Hours</div>
          <div className={cn('font-medium', actualHours > scheduledHours * 1.1 && 'text-amber-600')}>
            {hasClockIn ? `${actualHours.toFixed(1)}h` : '—'}
            {hasClockIn && !hasClockOut && <span className="text-muted-foreground text-xs ml-1">(in progress)</span>}
          </div>

          <div className="text-muted-foreground">Break</div>
          <div>{shift.breakMinutes ? `${shift.breakMinutes} min` : '—'}</div>

          <div className="text-muted-foreground">Attendance</div>
          <div className="font-medium">{formatHrEnumLabel(assignment.attendanceStatus)}</div>

          <div className="text-muted-foreground">Approval</div>
          <div className={cn('font-medium',
            isApproved && 'text-green-600',
            isRejected && 'text-red-600',
            isPending && 'text-amber-600',
          )}>
            {isApproved && '✓ '}
            {isRejected && '✗ '}
            {formatHrEnumLabel(assignment.approvalStatus)}
          </div>

          {assignment.note && (
            <>
              <div className="text-muted-foreground">Note</div>
              <div className="text-sm">{assignment.note}</div>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="border-t px-4 py-3 space-y-2.5 bg-muted/10">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Clock In */}
          {!hasClockIn && liveStatus !== 'on_leave' && liveStatus !== 'no_show' && (
            <button
              onClick={() => onUpdateAttendance(assignment.id, { attendanceStatus: 'present', actualStartTime: new Date().toISOString() })}
              disabled={!!busyKey}
              className="flex items-center gap-1.5 text-sm bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 disabled:opacity-50"
            >
              <LogIn className="h-3.5 w-3.5" /> Record Clock In
            </button>
          )}

          {/* Clock Out */}
          {hasClockIn && !hasClockOut && (
            <button
              onClick={() => onUpdateAttendance(assignment.id, { actualEndTime: new Date().toISOString() })}
              disabled={!!busyKey}
              className="flex items-center gap-1.5 text-sm bg-slate-600 text-white px-3 py-1.5 rounded hover:bg-slate-700 disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" /> Record Clock Out
            </button>
          )}

          {/* Mark Late */}
          {hasClockIn && String(assignment.attendanceStatus ?? '').trim() !== 'late' && liveStatus !== 'completed' && (
            <button
              onClick={() => onUpdateAttendance(assignment.id, { attendanceStatus: 'late' })}
              disabled={!!busyKey}
              className="text-sm border border-amber-300 text-amber-700 px-3 py-1.5 rounded hover:bg-amber-50 disabled:opacity-50"
            >
              Mark Late
            </button>
          )}

          {/* Mark Absent / No-Show */}
          {!hasClockIn && liveStatus !== 'on_leave' && String(assignment.attendanceStatus ?? '').trim() !== 'absent' && (
            <button
              onClick={() => onUpdateAttendance(assignment.id, { attendanceStatus: 'absent' })}
              disabled={!!busyKey}
              className="text-sm border border-red-300 text-red-600 px-3 py-1.5 rounded hover:bg-red-50 disabled:opacity-50"
            >
              Mark Absent
            </button>
          )}

          {/* Mark On Leave */}
          {!hasClockIn && String(assignment.attendanceStatus ?? '').trim() !== 'leave' && liveStatus !== 'no_show' && (
            <button
              onClick={() => onUpdateAttendance(assignment.id, { attendanceStatus: 'leave' })}
              disabled={!!busyKey}
              className="text-sm border px-3 py-1.5 rounded hover:bg-muted disabled:opacity-50"
            >
              Mark On Leave
            </button>
          )}

          {/* Approve */}
          {isPending && (
            <button
              onClick={() => onApprove(assignment.id)}
              disabled={!!busyKey}
              className="flex items-center gap-1.5 text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 disabled:opacity-50"
            >
              <UserCheck className="h-3.5 w-3.5" /> Approve
            </button>
          )}

          {/* Reject */}
          {isPending && !rejectOpen && (
            <button
              onClick={() => setRejectOpen(true)}
              disabled={!!busyKey}
              className="text-sm border border-red-200 text-red-600 px-3 py-1.5 rounded hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
          )}

          {isApproved && (
            <div className="flex items-center gap-1.5 text-sm text-green-700 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Hours Approved
            </div>
          )}

          {isRejected && (
            <div className="flex items-center gap-1.5 text-sm text-red-600">
              <X className="h-4 w-4" /> Rejected
            </div>
          )}
        </div>

        {/* Reject form */}
        {rejectOpen && (
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              placeholder="Rejection reason (optional)…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="flex-1 text-sm border rounded px-2 py-1.5"
              autoFocus
            />
            <button
              onClick={() => { onReject(assignment.id, rejectReason || undefined); setRejectOpen(false); setRejectReason(''); }}
              disabled={!!busyKey}
              className="text-sm bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 disabled:opacity-50 shrink-0"
            >
              Confirm Reject
            </button>
            <button onClick={() => { setRejectOpen(false); setRejectReason(''); }} className="text-xs text-muted-foreground hover:underline shrink-0">
              Cancel
            </button>
          </div>
        )}

        {/* Workflow hint */}
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70 pt-0.5">
          <span className="bg-muted rounded px-1">Assign</span>
          <span>→</span>
          <span className="bg-muted rounded px-1">Clock In</span>
          <span>→</span>
          <span className="bg-muted rounded px-1">Clock Out</span>
          <span>→</span>
          <span className="bg-muted rounded px-1">Approve</span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// LABOR REVIEW TAB
// ════════════════════════════════════════════════════════════

function LaborReviewTab({
  shifts, assignments, weekStart, onWeekChange, getUserName, busyKey, onApprove, onReject,
}: {
  shifts: ShiftView[];
  assignments: WorkShiftView[];
  weekStart: string;
  onWeekChange: (ws: string) => void;
  getUserName: (id: string | null | undefined) => string;
  busyKey: string;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const daySummaries = useMemo(
    () => weekDates.map((d) => computeDaySummary(shifts, assignments, d)),
    [shifts, assignments, weekDates],
  );

  const totals = useMemo(() => {
    return daySummaries.reduce(
      (acc, d) => ({
        scheduled: acc.scheduled + d.scheduledHours,
        actual: acc.actual + d.actualHours,
        overtime: acc.overtime + d.overtimeHours,
        approved: acc.approved + d.approvedCount,
        total: acc.total + d.totalCount,
        // clockedOut = eligible for approval (have actual end time)
        clockedOut: acc.clockedOut + d.clockedOutCount,
      }),
      { scheduled: 0, actual: 0, overtime: 0, approved: 0, total: 0, clockedOut: 0 },
    );
  }, [daySummaries]);

  return (
    <div className="space-y-4">
      {/* Week nav */}
      <div className="flex items-center gap-2">
        <button onClick={() => onWeekChange(addDays(weekStart, -7))} className="p-1.5 rounded hover:bg-muted border">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold">Week of {formatDateFull(weekStart)}</h2>
        <button onClick={() => onWeekChange(addDays(weekStart, 7))} className="p-1.5 rounded hover:bg-muted border">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => onWeekChange(getWeekStart(todayStr()))}
          className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50"
        >
          This Week
        </button>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Scheduled" value={`${totals.scheduled.toFixed(1)}h`} variant="default" />
        <MetricCard label="Actual" value={`${totals.actual.toFixed(1)}h`} variant={totals.actual > totals.scheduled * 1.05 ? 'warning' : 'default'} />
        <MetricCard label="Overtime" value={`${totals.overtime.toFixed(1)}h`} variant={totals.overtime > 0 ? 'warning' : 'default'} />
        <MetricCard label="Approved" value={`${totals.approved}/${totals.clockedOut}`} variant={totals.approved < totals.clockedOut ? 'info' : 'default'} />
      </div>

      {/* Day breakdown table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground text-xs">
              <th className="text-left px-3 py-2 border-b font-medium">Day</th>
              <th className="text-right px-3 py-2 border-b font-medium">Scheduled</th>
              <th className="text-right px-3 py-2 border-b font-medium">Actual</th>
              <th className="text-right px-3 py-2 border-b font-medium">+/−</th>
              <th className="text-right px-3 py-2 border-b font-medium">OT</th>
              <th className="text-right px-3 py-2 border-b font-medium">Late</th>
              <th className="text-right px-3 py-2 border-b font-medium">Absent</th>
              <th className="text-right px-3 py-2 border-b font-medium">Approved</th>
            </tr>
          </thead>
          <tbody>
            {daySummaries.map((day) => {
              const isExpanded = expandedDay === day.date;
              const dayAssignments = assignments.filter(
                (a) => a.workDate === day.date && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
              );
              return (
                <DayReviewRow
                  key={day.date}
                  day={day}
                  isExpanded={isExpanded}
                  onToggle={() => setExpandedDay(isExpanded ? null : day.date)}
                  dayAssignments={dayAssignments}
                  shifts={shifts}
                  getUserName={getUserName}
                  busyKey={busyKey}
                  onApprove={onApprove}
                  onReject={onReject}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Payroll readiness */}
      <div className={cn('border rounded-lg p-3 text-sm flex items-center gap-2',
        totals.clockedOut > 0 && totals.approved >= totals.clockedOut
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-amber-200 bg-amber-50 text-amber-700',
      )}>
        {totals.clockedOut === 0 ? (
          <><AlertTriangle className="h-4 w-4 shrink-0" /> No completed shifts to approve this week</>
        ) : totals.approved >= totals.clockedOut ? (
          <><CheckCircle2 className="h-4 w-4 shrink-0" /> All {totals.clockedOut} completed shifts approved — ready for payroll</>
        ) : (
          <><AlertTriangle className="h-4 w-4 shrink-0" /> {totals.clockedOut - totals.approved} of {totals.clockedOut} completed shifts pending approval</>
        )}
      </div>
    </div>
  );
}

function DayReviewRow({
  day, isExpanded, onToggle, dayAssignments, shifts, getUserName, busyKey, onApprove, onReject,
}: {
  day: DaySummary;
  isExpanded: boolean;
  onToggle: () => void;
  dayAssignments: WorkShiftView[];
  shifts: ShiftView[];
  getUserName: (id: string | null | undefined) => string;
  busyKey: string;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const allApproved = day.approvedCount >= day.totalCount && day.totalCount > 0;
  const isToday = day.date === todayStr();

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'cursor-pointer hover:bg-muted/40 transition-colors',
          isExpanded && 'bg-muted/20',
          isToday && 'font-medium',
        )}
      >
        <td className="px-3 py-2.5 border-b">
          <div className="flex items-center gap-1.5">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            {formatDateShort(day.date)}
            {isToday && <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded ml-1">Today</span>}
          </div>
        </td>
        <td className="text-right px-3 py-2.5 border-b text-muted-foreground">{day.scheduledHours.toFixed(1)}h</td>
        <td className="text-right px-3 py-2.5 border-b">{day.actualHours > 0 ? `${day.actualHours.toFixed(1)}h` : '—'}</td>
        <td className={cn('text-right px-3 py-2.5 border-b text-sm', day.variance > 0 ? 'text-amber-600' : day.variance < 0 ? 'text-green-600' : '')}>
          {day.actualHours > 0 ? `${day.variance > 0 ? '+' : ''}${day.variance.toFixed(1)}h` : '—'}
        </td>
        <td className={cn('text-right px-3 py-2.5 border-b', day.overtimeHours > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
          {day.overtimeHours > 0 ? `${day.overtimeHours.toFixed(1)}h` : '—'}
        </td>
        <td className={cn('text-right px-3 py-2.5 border-b', day.lateCount > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
          {day.lateCount || '—'}
        </td>
        <td className={cn('text-right px-3 py-2.5 border-b', day.absentCount > 0 ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
          {day.absentCount || '—'}
        </td>
        <td className="text-right px-3 py-2.5 border-b">
          {allApproved ? (
            <span className="text-green-600 font-medium">✓ {day.approvedCount}/{day.totalCount}</span>
          ) : (
            <span className="text-amber-600">{day.approvedCount}/{day.totalCount}</span>
          )}
        </td>
      </tr>

      {isExpanded && dayAssignments.map((a) => {
        const shift = shiftMap.get(String(a.shiftId ?? ''));
        const isPending = String(a.approvalStatus ?? '').trim() === 'pending';
        const isApproved = String(a.approvalStatus ?? '').trim() === 'approved';
        const hasClockOut = !!a.actualEndTime;
        return (
          <tr key={a.id} className="bg-muted/10 text-sm">
            <td className="px-3 py-2 border-b pl-9">
              <div className="font-medium">{workShiftUserName(a, getUserName)}</div>
              {shift && <div className="text-xs text-muted-foreground">{shift.name}</div>}
            </td>
            <td className="text-right px-3 py-2 border-b text-xs text-muted-foreground">
              {getWorkRoleLabel(a.workRole)}
            </td>
            <td className="text-right px-3 py-2 border-b text-xs">
              {a.actualStartTime ? formatClockTime(a.actualStartTime) : '—'}
              {a.actualEndTime ? ` → ${formatClockTime(a.actualEndTime)}` : a.actualStartTime ? ' →…' : ''}
            </td>
            <td className="px-3 py-2 border-b" colSpan={2}></td>
            <td className="text-right px-3 py-2 border-b text-xs">
              {String(a.attendanceStatus ?? '').trim() === 'late' && <span className="text-amber-600 font-medium">Late</span>}
            </td>
            <td className="text-right px-3 py-2 border-b text-xs">
              {String(a.attendanceStatus ?? '').trim() === 'absent' && <span className="text-red-600 font-medium">Absent</span>}
              {String(a.attendanceStatus ?? '').trim() === 'leave' && <span className="text-blue-600">Leave</span>}
            </td>
            <td className="text-right px-3 py-2 border-b">
              {isApproved ? (
                <span className="text-green-600 text-xs font-medium">✓ Approved</span>
              ) : hasClockOut ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onApprove(a.id); }}
                  disabled={!!busyKey}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                >
                  Approve
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">No clock-out</span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ════════════════════════════════════════════════════════════

function MetricCard({ label, value, variant }: { label: string; value: string; variant: 'default' | 'warning' | 'danger' | 'info' }) {
  return (
    <div className={cn(
      'rounded-lg border p-3 text-center',
      variant === 'warning' && 'border-amber-200 bg-amber-50',
      variant === 'danger' && 'border-red-200 bg-red-50',
      variant === 'info' && 'border-blue-200 bg-blue-50',
    )}>
      <div className={cn(
        'text-2xl font-bold',
        variant === 'warning' && 'text-amber-700',
        variant === 'danger' && 'text-red-700',
        variant === 'info' && 'text-blue-700',
      )}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function QuickAssignModal({
  users, shiftId, workRole, date, busyKey, assignedUserIds, onAssign, onClose,
}: {
  users: AuthUserListItem[];
  shiftId: string;
  workRole: string;
  date: string;
  busyKey: string;
  assignedUserIds: string[];
  onAssign: (userId: string) => void;
  onClose: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const assignedSet = new Set(assignedUserIds);
    return users.filter((u) => {
      if (assignedSet.has(String(u.id))) return false;
      if (!search) return true;
      return userDisplayName(u).toLowerCase().includes(search.toLowerCase());
    });
  }, [users, assignedUserIds, search]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background border rounded-xl shadow-xl p-4 w-96 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">
            Assign Staff{workRole ? ` — ${getWorkRoleLabel(workRole)}` : ''}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          type="text"
          placeholder="Search staff…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border rounded px-2.5 py-1.5 text-sm"
          autoFocus
        />
        <div className="max-h-52 overflow-y-auto border rounded divide-y">
          {filtered.length === 0 && (
            <div className="text-xs text-muted-foreground p-3 text-center">
              {users.length === 0 ? 'No staff data loaded' : 'No available staff found'}
            </div>
          )}
          {filtered.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUserId(String(u.id))}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors',
                String(u.id) === selectedUserId && 'bg-primary/10 font-medium',
              )}
            >
              {userDisplayName(u)}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:underline px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={() => selectedUserId && onAssign(selectedUserId)}
            disabled={!selectedUserId || !!busyKey}
            className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded hover:bg-primary/90 disabled:opacity-50 font-medium"
          >
            {busyKey === 'assign' ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
