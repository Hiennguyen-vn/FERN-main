import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutDashboard,
  RefreshCw,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  authApi,
  hrApi,
  type AuthUserListItem,
  type AuthUsersQuery,
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
// MAIN MODULE
// ════════════════════════════════════════════════════════════

export function WorkforceModule() {
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
  const [selectedTimecardId, setSelectedTimecardId] = useState<string | null>(null);

  // ── Data loading ──

  const loadData = useCallback(async () => {
    if (!token || !outletId) return;
    setLoading(true);
    setError('');
    try {
      const [shiftsData, usersData] = await Promise.all([
        hrApi.shifts(token, outletId),
        collectPagedItems<AuthUserListItem, AuthUsersQuery>(
          (query) => authApi.users(token, query),
          { sortBy: 'username', sortDir: 'asc' as const },
          200,
        ).catch(() => [] as AuthUserListItem[]),
      ]);
      setShifts(shiftsData);
      setUsers(usersData);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token, outletId]);

  const loadAssignments = useCallback(async (startDate: string, endDate: string) => {
    if (!token || !outletId) return;
    try {
      const data = await hrApi.workShifts(token, {
        outletId,
        startDate,
        endDate,
        limit: 200,
        offset: 0,
        sortBy: 'workDate',
        sortDir: 'asc',
      });
      setAssignments(data);
    } catch (err) {
      toast.error('Failed to load assignments: ' + getErrorMessage(err));
    }
  }, [token, outletId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (activeTab === 'daily-board' || activeTab === 'attendance') {
      loadAssignments(dateFilter, dateFilter);
    } else if (activeTab === 'schedule') {
      const weekEnd = addDays(weekStart, 6);
      loadAssignments(weekStart, weekEnd);
    } else if (activeTab === 'review') {
      const weekEnd = addDays(weekStart, 6);
      loadAssignments(weekStart, weekEnd);
    }
  }, [activeTab, dateFilter, weekStart, loadAssignments]);

  const userMap = useMemo(() => new Map(users.map((u) => [String(u.id), u])), [users]);
  const getUserName = useCallback(
    (userId: string | null | undefined) => {
      const display = getHrUserDisplay(userMap, userId);
      return display.primary;
    },
    [userMap],
  );

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
      toast.success('Approved');
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
    return <ServiceUnavailablePage service="Workforce" detail={error} />;
  }

  return (
    <div className="space-y-4 p-4">
      {/* Tab bar */}
      <div className="flex items-center gap-2 border-b pb-2">
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
          <button onClick={refresh} disabled={loading} className="p-1.5 rounded hover:bg-muted">
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
          users={users}
          busyKey={busyKey}
          onUpdateAttendance={doUpdateAttendance}
          onApprove={doApprove}
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
          users={users}
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
  onUpdateAttendance, onApprove, onAssign,
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
  onAssign: (shiftId: string, userId: string, workDate: string, workRole?: string) => void;
}) {
  const now = useMemo(() => new Date(), [assignments]);
  const metrics = useMemo(() => computeDailyMetrics(shifts, assignments, date, now), [shifts, assignments, date, now]);
  const daypartGroups = useMemo(() => groupByDaypart(shifts, assignments, date, now), [shifts, assignments, date, now]);
  const exceptions = useMemo(() => deriveExceptions(shifts, assignments, date, now), [shifts, assignments, date, now]);

  const [assignModal, setAssignModal] = useState<{ shiftId: string; workRole: string } | null>(null);

  return (
    <div className="space-y-4">
      {/* Date nav */}
      <div className="flex items-center gap-3">
        <button onClick={() => onDateChange(addDays(date, -1))} className="p-1 rounded hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
        <h2 className="text-lg font-semibold">{formatDateFull(date)}</h2>
        <button onClick={() => onDateChange(addDays(date, 1))} className="p-1 rounded hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
        {date !== todayStr() && (
          <button onClick={() => onDateChange(todayStr())} className="text-xs text-muted-foreground hover:underline">Today</button>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-5 gap-3">
        <MetricCard label="On Floor" value={`${metrics.onFloor}/${metrics.totalAssigned}`} variant={metrics.onFloor < metrics.totalAssigned ? 'warning' : 'default'} />
        <MetricCard label="Coverage" value={`${metrics.coveragePercent}%`} variant={metrics.coveragePercent < 80 ? 'warning' : 'default'} />
        <MetricCard label="Late" value={String(metrics.lateCount)} variant={metrics.lateCount > 0 ? 'warning' : 'default'} />
        <MetricCard label="No-Show" value={String(metrics.noShowCount)} variant={metrics.noShowCount > 0 ? 'danger' : 'default'} />
        <MetricCard label="Pending Review" value={String(metrics.pendingReview)} variant={metrics.pendingReview > 0 ? 'info' : 'default'} />
      </div>

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
          onAssignClick={(shiftId, workRole) => setAssignModal({ shiftId, workRole })}
        />
      ))}

      {/* Exceptions queue */}
      {exceptions.length > 0 && (
        <div className="border rounded-lg p-3 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Issues ({exceptions.length})
          </h3>
          {exceptions.map((ex, i) => (
            <div key={i} className="flex items-center gap-2 text-sm py-1 border-t first:border-0">
              <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium', severityBadgeClass(ex.severity))}>
                {ex.type === 'no_show' ? 'NO-SHOW' : ex.type === 'late' ? 'LATE' : 'UNFILLED'}
              </span>
              <span className="text-muted-foreground">
                {ex.employeeId ? getUserName(ex.employeeId) : '—'}
              </span>
              <span className="text-muted-foreground">
                {ex.shiftName}{ex.workRole ? ` / ${getWorkRoleLabel(ex.workRole)}` : ''}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">{ex.detail}</span>
              {ex.type === 'no_show' && ex.workShiftId && (
                <button
                  onClick={() => onUpdateAttendance(ex.workShiftId!, { attendanceStatus: 'absent' })}
                  disabled={!!busyKey}
                  className="text-xs text-red-600 hover:underline"
                >
                  Mark Absent
                </button>
              )}
              {ex.type === 'unfilled' && (
                <button
                  onClick={() => setAssignModal({ shiftId: ex.shiftId, workRole: ex.workRole ?? '' })}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Assign
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick assign modal */}
      {assignModal && (
        <QuickAssignModal
          users={users}
          shiftId={assignModal.shiftId}
          workRole={assignModal.workRole}
          date={date}
          busyKey={busyKey}
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

// ── Daypart section component ──

function DaypartSection({
  group, date, now, getUserName, busyKey,
  onUpdateAttendance, onApprove, onAssignClick,
}: {
  group: DaypartGroup;
  date: string;
  now: Date;
  getUserName: (id: string | null | undefined) => string;
  busyKey: string;
  onUpdateAttendance: (id: string, payload: Record<string, unknown>) => void;
  onApprove: (id: string) => void;
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
    <div className="border rounded-lg">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <span className="font-semibold text-sm">{group.label}</span>
        <span className="text-xs text-muted-foreground">
          {group.shifts.map((s) => `${formatShiftTime(s.shift.startTime)}–${formatShiftTime(s.shift.endTime)}`).join(', ')}
        </span>
        <span className={cn('text-xs font-medium ml-2', coverageTextClass(totalAssigned, totalRequired))}>
          {totalAssigned}/{totalRequired}
        </span>
        <span className={cn('ml-auto text-xs px-1.5 py-0.5 rounded', progressBadgeClass(overallProgress))}>
          {overallProgress === 'completed' ? '✓ Completed' : overallProgress === 'in_progress' ? '● In Progress' : '○ Not Started'}
        </span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {group.shifts.map(({ shift, assignments: shiftAssignments, roleCoverage, unfilled }) => (
            <div key={shift.id} className="space-y-1.5">
              {/* Role coverage bar */}
              {roleCoverage.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {roleCoverage.map((rc) => (
                    <span key={rc.workRole} className={cn('font-medium', coverageTextClass(rc.assigned, rc.required))}>
                      {getWorkRoleLabel(rc.workRole)} {rc.assigned}/{rc.required}
                      {rc.assigned >= rc.required ? ' ✓' : ' ⚠'}
                    </span>
                  ))}
                </div>
              )}

              {/* Assignment cards */}
              {shiftAssignments
                .filter((a) => String(a.scheduleStatus ?? '').trim() !== 'cancelled')
                .map((a) => {
                  const liveStatus = deriveLiveStatus(a, shift, date, now);
                  return (
                    <div key={a.id} className="flex items-center gap-2 py-1.5 px-2 rounded bg-muted/30 text-sm">
                      <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium', liveStatusBadgeClass(liveStatus))}>
                        {getLiveStatusLabel(liveStatus)}
                      </span>
                      <span className="font-medium">{getUserName(a.userId)}</span>
                      <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                        {getWorkRoleLabel(a.workRole)}
                      </span>
                      {a.actualStartTime && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          In: {formatClockTime(a.actualStartTime)}
                          {a.actualEndTime ? ` Out: ${formatClockTime(a.actualEndTime)}` : ''}
                        </span>
                      )}
                      {liveStatus === 'late' && (
                        <button
                          onClick={() => onUpdateAttendance(a.id, { note: 'Late acknowledged' })}
                          disabled={!!busyKey}
                          className="text-xs text-amber-600 hover:underline ml-1"
                        >
                          Ack
                        </button>
                      )}
                      {String(a.approvalStatus ?? '').trim() === 'pending' && liveStatus === 'completed' && (
                        <button
                          onClick={() => onApprove(a.id)}
                          disabled={!!busyKey}
                          className="text-xs text-green-600 hover:underline ml-1"
                        >
                          Approve
                        </button>
                      )}
                    </div>
                  );
                })}

              {/* Unfilled slots */}
              {unfilled.map((slot, i) => (
                <div key={`unfilled-${shift.id}-${slot.workRole}-${i}`} className="flex items-center gap-2 py-1.5 px-2 rounded border border-dashed border-red-300 bg-red-50/50 text-sm">
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">OPEN</span>
                  <span className="text-muted-foreground">
                    {getWorkRoleLabel(slot.workRole)} — {slot.gap} needed
                  </span>
                  <button
                    onClick={() => onAssignClick(shift.id, slot.workRole)}
                    className="ml-auto text-xs text-blue-600 hover:underline"
                  >
                    Assign
                  </button>
                </div>
              ))}
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

  // Group shifts by daypart
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

  // Totals
  const totalShiftsWeek = shifts.length * 7;
  const totalAssigned = weekDates.reduce((sum, d) => {
    return sum + assignments.filter((a) => a.workDate === d && String(a.scheduleStatus ?? '').trim() !== 'cancelled').length;
  }, 0);
  const totalRequired = weekDates.reduce((sum, d) => {
    return sum + shifts.reduce((s2, shift) => s2 + (Number(shift.headcountRequired) || 1), 0);
  }, 0);
  const totalGaps = totalRequired - totalAssigned;

  return (
    <div className="space-y-4">
      {/* Week nav */}
      <div className="flex items-center gap-3">
        <button onClick={() => onWeekChange(addDays(weekStart, -7))} className="p-1 rounded hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
        <h2 className="text-lg font-semibold">Week of {formatDateFull(weekStart)}</h2>
        <button onClick={() => onWeekChange(addDays(weekStart, 7))} className="p-1 rounded hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
      </div>

      <div className="text-sm text-muted-foreground">
        Assigned: {totalAssigned}/{totalRequired} · Gaps: {totalGaps > 0 ? <span className="text-amber-600 font-medium">{totalGaps}</span> : '0'}
      </div>

      {/* Week grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left p-2 border-b w-32"></th>
              {weekDates.map((d) => (
                <th key={d} className={cn('text-center p-2 border-b', d === todayStr() && 'bg-blue-50')}>
                  {formatDateShort(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shiftsByDaypart.map(([daypart, dpShifts]) => (
              dpShifts.map((shift, si) => (
                <tr key={shift.id}>
                  {si === 0 && (
                    <td rowSpan={dpShifts.length} className="p-2 border-b align-top font-medium text-xs text-muted-foreground uppercase">
                      {getDaypartLabel(daypart as any)}
                      <br />
                      <span className="text-[10px] normal-case font-normal">
                        {formatShiftTime(dpShifts[0]?.startTime)}–{formatShiftTime(dpShifts[dpShifts.length - 1]?.endTime)}
                      </span>
                    </td>
                  )}
                  {weekDates.map((d) => {
                    const cov = computeWeekCoverage(shift, assignments, d);
                    const isSelected = selectedCell?.shiftId === shift.id && selectedCell?.date === d;
                    return (
                      <td
                        key={d}
                        onClick={() => setSelectedCell({ shiftId: shift.id, date: d })}
                        className={cn(
                          'text-center p-2 border-b cursor-pointer hover:bg-muted/50 transition-colors',
                          d === todayStr() && 'bg-blue-50/50',
                          isSelected && 'ring-2 ring-primary ring-inset',
                          cov.gap > 0 && 'bg-amber-50/50',
                          cov.assigned === 0 && cov.required > 0 && 'bg-red-50/50',
                        )}
                      >
                        <span className={cn('font-medium text-xs', coverageTextClass(cov.assigned, cov.required))}>
                          {cov.assigned}/{cov.required}
                        </span>
                        {cov.gap > 0 && <span className="text-xs text-amber-600 ml-0.5">⚠</span>}
                      </td>
                    );
                  })}
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </div>

      {/* Selected cell detail */}
      {selectedCell && (
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

  if (!shift) return null;

  const cellAssignments = assignments.filter(
    (a) => String(a.shiftId ?? '') === shift.id && a.workDate === date && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
  );
  const roles = shift.roleRequirements ?? [];

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{shift.name} — {formatDateFull(date)}</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:underline">Close</button>
      </div>

      {roles.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground uppercase">Role Coverage</div>
          {roles.map((req) => {
            const assigned = cellAssignments.filter((a) => String(a.workRole ?? '').trim() === req.workRole).length;
            return (
              <div key={req.workRole} className="flex items-center gap-2 text-sm">
                <span className={cn('font-medium', coverageTextClass(assigned, req.requiredCount))}>
                  {getWorkRoleLabel(req.workRole)}: {assigned}/{req.requiredCount}
                </span>
                {assigned < req.requiredCount && (
                  <button
                    onClick={() => setAssignRole(req.workRole)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    + Assign
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground uppercase">Assigned ({cellAssignments.length})</div>
        {cellAssignments.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm py-1">
            <span>● {getUserName(a.userId)}</span>
            {a.workRole && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{getWorkRoleLabel(a.workRole)}</span>
            )}
          </div>
        ))}
        {cellAssignments.length === 0 && <div className="text-xs text-muted-foreground">No staff assigned</div>}
      </div>

      {/* Assign staff form — always visible */}
      <div className="border-t pt-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase">Assign Staff</div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={assignUserId}
            onChange={(e) => setAssignUserId(e.target.value)}
            className="text-sm border rounded px-2 py-1.5 min-w-[180px]"
          >
            <option value="">Select staff...</option>
            {users.filter((u) => !cellAssignments.some((a) => String(a.userId) === String(u.id))).map((u) => (
              <option key={u.id} value={u.id}>{userDisplayName(u)}</option>
            ))}
          </select>
          {roles.length > 0 ? (
            <select
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
              className="text-sm border rounded px-2 py-1.5 min-w-[140px]"
            >
              <option value="">Work role...</option>
              {roles.map((req) => (
                <option key={req.workRole} value={req.workRole}>{getWorkRoleLabel(req.workRole)}</option>
              ))}
            </select>
          ) : (
            <select
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
              className="text-sm border rounded px-2 py-1.5 min-w-[140px]"
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
              }
            }}
            disabled={!assignUserId || !!busyKey}
            className="text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded disabled:opacity-50 hover:bg-primary/90"
          >
            {busyKey === 'assign' ? 'Assigning...' : 'Assign'}
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
  busyKey, onUpdateAttendance, onApprove,
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
}) {
  const now = useMemo(() => new Date(), [assignments]);
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  // Sort: exceptions first
  const sorted = useMemo(() => {
    return [...assignments]
      .filter((a) => String(a.scheduleStatus ?? '').trim() !== 'cancelled')
      .sort((a, b) => {
        const shiftA = shiftMap.get(String(a.shiftId ?? ''));
        const shiftB = shiftMap.get(String(b.shiftId ?? ''));
        const statusA = shiftA ? deriveLiveStatus(a, shiftA, date, now) : 'assigned';
        const statusB = shiftB ? deriveLiveStatus(b, shiftB, date, now) : 'assigned';
        const exOrder: Record<string, number> = { no_show: 0, late: 1, checked_in: 2, on_leave: 3, assigned: 4, confirmed: 4, completed: 5 };
        return (exOrder[statusA] ?? 4) - (exOrder[statusB] ?? 4);
      });
  }, [assignments, shiftMap, date, now]);

  const selected = selectedId ? assignments.find((a) => a.id === selectedId) : sorted[0];
  const selectedShift = selected ? shiftMap.get(String(selected.shiftId ?? '')) : undefined;

  return (
    <div className="space-y-4">
      {/* Date nav */}
      <div className="flex items-center gap-3">
        <button onClick={() => onDateChange(addDays(date, -1))} className="p-1 rounded hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
        <h2 className="text-lg font-semibold">{formatDateFull(date)}</h2>
        <button onClick={() => onDateChange(addDays(date, 1))} className="p-1 rounded hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Timecard list */}
        <div className="col-span-1 space-y-1 border rounded-lg p-2 max-h-[600px] overflow-y-auto">
          <div className="text-xs font-medium text-muted-foreground uppercase px-1 pb-1">Timecards ({sorted.length})</div>
          {sorted.map((a) => {
            const shift = shiftMap.get(String(a.shiftId ?? ''));
            const liveStatus = shift ? deriveLiveStatus(a, shift, date, now) : ('assigned' as LiveStatus);
            const isSelected = a.id === (selected?.id ?? sorted[0]?.id);
            return (
              <button
                key={a.id}
                onClick={() => onSelectId(a.id)}
                className={cn(
                  'w-full text-left p-2 rounded text-sm transition-colors',
                  isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/50',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-full', {
                    'bg-green-500': liveStatus === 'checked_in',
                    'bg-amber-500': liveStatus === 'late',
                    'bg-red-500': liveStatus === 'no_show',
                    'bg-gray-400': liveStatus === 'completed' || liveStatus === 'assigned',
                    'bg-blue-400': liveStatus === 'on_leave',
                  })} />
                  <span className="font-medium truncate">{getUserName(a.userId)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <span>{getWorkRoleLabel(a.workRole)}</span>
                  <span>·</span>
                  <span>{shift ? `${formatShiftTime(shift.startTime)}–${formatShiftTime(shift.endTime)}` : '—'}</span>
                  <span>·</span>
                  <span className={cn(liveStatusBadgeClass(liveStatus), 'px-1 rounded text-[10px]')}>
                    {getLiveStatusLabel(liveStatus)}
                  </span>
                </div>
              </button>
            );
          })}
          {sorted.length === 0 && <div className="text-xs text-muted-foreground p-2">No timecards for this date</div>}
        </div>

        {/* Detail panel */}
        <div className="col-span-2 border rounded-lg p-4 space-y-3">
          {selected && selectedShift ? (
            <TimecardDetail
              assignment={selected}
              shift={selectedShift}
              date={date}
              now={now}
              getUserName={getUserName}
              busyKey={busyKey}
              onUpdateAttendance={onUpdateAttendance}
              onApprove={onApprove}
            />
          ) : (
            <div className="text-sm text-muted-foreground">Select a timecard to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimecardDetail({
  assignment, shift, date, now, getUserName, busyKey, onUpdateAttendance, onApprove,
}: {
  assignment: WorkShiftView;
  shift: ShiftView;
  date: string;
  now: Date;
  getUserName: (id: string | null | undefined) => string;
  busyKey: string;
  onUpdateAttendance: (id: string, payload: Record<string, unknown>) => void;
  onApprove: (id: string) => void;
}) {
  const liveStatus = deriveLiveStatus(assignment, shift, date, now);
  const scheduledHours = (() => {
    const s = String(shift.startTime ?? '').trim();
    const e = String(shift.endTime ?? '').trim();
    if (!s || !e) return 0;
    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
  })();

  const actualHours = (() => {
    if (!assignment.actualStartTime) return 0;
    const start = new Date(assignment.actualStartTime);
    const end = assignment.actualEndTime ? new Date(assignment.actualEndTime) : now;
    return Math.max(0, (end.getTime() - start.getTime()) / 3600000);
  })();

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{getUserName(assignment.userId)}</h3>
        <span className={cn('px-2 py-0.5 rounded text-xs font-medium', liveStatusBadgeClass(liveStatus))}>
          {getLiveStatusLabel(liveStatus)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="text-muted-foreground">Shift</div>
        <div>{shift.name} · {formatShiftTime(shift.startTime)}–{formatShiftTime(shift.endTime)}</div>
        <div className="text-muted-foreground">Work Role</div>
        <div>{getWorkRoleLabel(assignment.workRole)}</div>
        <div className="text-muted-foreground">Scheduled</div>
        <div>{formatShiftTime(shift.startTime)} — {formatShiftTime(shift.endTime)} ({scheduledHours.toFixed(1)}h)</div>
        <div className="text-muted-foreground">Actual</div>
        <div>
          {assignment.actualStartTime ? formatClockTime(assignment.actualStartTime) : '—'}
          {' — '}
          {assignment.actualEndTime ? formatClockTime(assignment.actualEndTime) : '(in progress)'}
          {assignment.actualStartTime && ` (${actualHours.toFixed(1)}h)`}
        </div>
        <div className="text-muted-foreground">Break Allowed</div>
        <div>{shift.breakMinutes ?? 0} min</div>
        <div className="text-muted-foreground">Attendance</div>
        <div>{formatHrEnumLabel(assignment.attendanceStatus)}</div>
        <div className="text-muted-foreground">Approval</div>
        <div>{formatHrEnumLabel(assignment.approvalStatus)}</div>
        {assignment.note && (
          <>
            <div className="text-muted-foreground">Note</div>
            <div>{assignment.note}</div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t pt-3">
        {!assignment.actualStartTime && liveStatus !== 'no_show' && liveStatus !== 'on_leave' && (
          <button
            onClick={() => onUpdateAttendance(assignment.id, { attendanceStatus: 'present', actualStartTime: new Date().toISOString() })}
            disabled={!!busyKey}
            className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 disabled:opacity-50"
          >
            Clock In
          </button>
        )}
        {assignment.actualStartTime && !assignment.actualEndTime && (
          <button
            onClick={() => onUpdateAttendance(assignment.id, { actualEndTime: new Date().toISOString() })}
            disabled={!!busyKey}
            className="text-xs bg-gray-600 text-white px-3 py-1.5 rounded hover:bg-gray-700 disabled:opacity-50"
          >
            Clock Out
          </button>
        )}
        {String(assignment.approvalStatus ?? '').trim() === 'pending' && (
          <button
            onClick={() => onApprove(assignment.id)}
            disabled={!!busyKey}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded disabled:opacity-50"
          >
            Approve
          </button>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════
// LABOR REVIEW TAB
// ════════════════════════════════════════════════════════════

function LaborReviewTab({
  shifts, assignments, weekStart, onWeekChange, getUserName, busyKey, onApprove,
}: {
  shifts: ShiftView[];
  assignments: WorkShiftView[];
  weekStart: string;
  onWeekChange: (ws: string) => void;
  getUserName: (id: string | null | undefined) => string;
  busyKey: string;
  onApprove: (id: string) => void;
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
      }),
      { scheduled: 0, actual: 0, overtime: 0, approved: 0, total: 0 },
    );
  }, [daySummaries]);

  return (
    <div className="space-y-4">
      {/* Week nav */}
      <div className="flex items-center gap-3">
        <button onClick={() => onWeekChange(addDays(weekStart, -7))} className="p-1 rounded hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
        <h2 className="text-lg font-semibold">Week of {formatDateFull(weekStart)}</h2>
        <button onClick={() => onWeekChange(addDays(weekStart, 7))} className="p-1 rounded hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Scheduled" value={`${totals.scheduled.toFixed(1)}h`} variant="default" />
        <MetricCard label="Actual" value={`${totals.actual.toFixed(1)}h`} variant={totals.actual > totals.scheduled * 1.05 ? 'warning' : 'default'} />
        <MetricCard label="Overtime" value={`${totals.overtime.toFixed(1)}h`} variant={totals.overtime > 0 ? 'warning' : 'default'} />
        <MetricCard label="Approved" value={`${totals.approved}/${totals.total}`} variant={totals.approved < totals.total ? 'info' : 'default'} />
      </div>

      {/* Day breakdown */}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left p-2 border-b">Day</th>
            <th className="text-right p-2 border-b">Scheduled</th>
            <th className="text-right p-2 border-b">Actual</th>
            <th className="text-right p-2 border-b">+/-</th>
            <th className="text-right p-2 border-b">OT</th>
            <th className="text-right p-2 border-b">Late</th>
            <th className="text-right p-2 border-b">Absent</th>
            <th className="text-right p-2 border-b">Approved</th>
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
              />
            );
          })}
        </tbody>
      </table>

      {/* Payroll readiness */}
      <div className="border rounded-lg p-3 text-sm">
        {totals.approved >= totals.total && totals.total > 0 ? (
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            All shifts approved — ready for payroll
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            {totals.total - totals.approved} shifts pending approval
          </div>
        )}
      </div>
    </div>
  );
}

function DayReviewRow({
  day, isExpanded, onToggle, dayAssignments, shifts, getUserName, busyKey, onApprove,
}: {
  day: DaySummary;
  isExpanded: boolean;
  onToggle: () => void;
  dayAssignments: WorkShiftView[];
  shifts: ShiftView[];
  getUserName: (id: string | null | undefined) => string;
  busyKey: string;
  onApprove: (id: string) => void;
}) {
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const allApproved = day.approvedCount >= day.totalCount && day.totalCount > 0;

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn('cursor-pointer hover:bg-muted/50', isExpanded && 'bg-muted/30')}
      >
        <td className="p-2 border-b font-medium flex items-center gap-1">
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {formatDateShort(day.date)}
        </td>
        <td className="text-right p-2 border-b">{day.scheduledHours.toFixed(1)}h</td>
        <td className="text-right p-2 border-b">{day.actualHours > 0 ? `${day.actualHours.toFixed(1)}h` : '—'}</td>
        <td className={cn('text-right p-2 border-b', day.variance > 0 ? 'text-amber-600' : '')}>
          {day.actualHours > 0 ? `${day.variance > 0 ? '+' : ''}${day.variance.toFixed(1)}h` : '—'}
        </td>
        <td className={cn('text-right p-2 border-b', day.overtimeHours > 0 ? 'text-amber-600' : '')}>
          {day.overtimeHours > 0 ? `${day.overtimeHours.toFixed(1)}h` : '—'}
        </td>
        <td className={cn('text-right p-2 border-b', day.lateCount > 0 ? 'text-amber-600' : '')}>{day.lateCount || '—'}</td>
        <td className={cn('text-right p-2 border-b', day.absentCount > 0 ? 'text-red-600' : '')}>{day.absentCount || '—'}</td>
        <td className="text-right p-2 border-b">
          {allApproved ? (
            <span className="text-green-600">✓ {day.approvedCount}/{day.totalCount}</span>
          ) : (
            <span className="text-amber-600">{day.approvedCount}/{day.totalCount}</span>
          )}
        </td>
      </tr>
      {isExpanded && dayAssignments.map((a) => {
        const shift = shiftMap.get(String(a.shiftId ?? ''));
        return (
          <tr key={a.id} className="bg-muted/20">
            <td className="p-2 border-b pl-8">{getUserName(a.userId)}</td>
            <td className="text-right p-2 border-b text-xs text-muted-foreground">{getWorkRoleLabel(a.workRole)}</td>
            <td className="text-right p-2 border-b text-xs">
              {a.actualStartTime ? formatClockTime(a.actualStartTime) : '—'}
              {a.actualEndTime ? ` – ${formatClockTime(a.actualEndTime)}` : ''}
            </td>
            <td className="p-2 border-b" colSpan={2}></td>
            <td className="text-right p-2 border-b text-xs">
              {String(a.attendanceStatus ?? '').trim() === 'late' && <span className="text-amber-600">Late</span>}
              {String(a.attendanceStatus ?? '').trim() === 'absent' && <span className="text-red-600">Absent</span>}
            </td>
            <td className="p-2 border-b"></td>
            <td className="text-right p-2 border-b">
              {String(a.approvalStatus ?? '').trim() === 'approved' ? (
                <span className="text-green-600 text-xs">✓</span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onApprove(a.id); }}
                  disabled={!!busyKey}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                >
                  Approve
                </button>
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
      variant === 'warning' && 'border-amber-300 bg-amber-50',
      variant === 'danger' && 'border-red-300 bg-red-50',
      variant === 'info' && 'border-blue-300 bg-blue-50',
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
  users, shiftId, workRole, date, busyKey, onAssign, onClose,
}: {
  users: AuthUserListItem[];
  shiftId: string;
  workRole: string;
  date: string;
  busyKey: string;
  onAssign: (userId: string) => void;
  onClose: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter((u) => userDisplayName(u).toLowerCase().includes(q));
  }, [users, search]);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background border rounded-lg p-4 w-80 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-sm">
          Quick Assign — {getWorkRoleLabel(workRole)}
        </h3>
        <input
          type="text"
          placeholder="Search staff..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border rounded px-2 py-1 text-sm"
          autoFocus
        />
        <div className="max-h-48 overflow-y-auto space-y-1">
          {filtered.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUserId(String(u.id))}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted',
                String(u.id) === selectedUserId && 'bg-primary/10 ring-1 ring-primary/30',
              )}
            >
              {userDisplayName(u)}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-muted-foreground hover:underline">Cancel</button>
          <button
            onClick={() => selectedUserId && onAssign(selectedUserId)}
            disabled={!selectedUserId || !!busyKey}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
