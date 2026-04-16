import type { ShiftView, WorkShiftView, RoleRequirementView } from '@/api/fern-api';
import type {
  Daypart,
  LiveStatus,
  ShiftProgress,
  RoleCoverage,
  DailyBoardMetrics,
  DerivedException,
  DaySummary,
} from '@/types/workforce';

// ── Constants ──

const DAYPART_ORDER: Daypart[] = ['opening', 'breakfast', 'lunch_peak', 'afternoon', 'closing'];

const DAYPART_LABELS: Record<Daypart, string> = {
  opening: 'Opening / Prep',
  breakfast: 'Breakfast',
  lunch_peak: 'Lunch Peak',
  afternoon: 'Afternoon',
  closing: 'Closing',
};

const WORK_ROLE_LABELS: Record<string, string> = {
  cashier: 'Cashier',
  kitchen_staff: 'Kitchen',
  prep: 'Prep',
  support: 'Support',
  closing_support: 'Closing',
};

const LIVE_STATUS_LABELS: Record<LiveStatus, string> = {
  assigned: 'Assigned',
  confirmed: 'Confirmed',
  checked_in: 'Checked In',
  late: 'Late',
  no_show: 'No-Show',
  on_leave: 'On Leave',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const LATE_THRESHOLD_MINUTES = 15;
const NO_SHOW_THRESHOLD_MINUTES = 30;

export {
  DAYPART_ORDER,
  DAYPART_LABELS,
  WORK_ROLE_LABELS,
  LIVE_STATUS_LABELS,
  LATE_THRESHOLD_MINUTES,
  NO_SHOW_THRESHOLD_MINUTES,
};

// ── Daypart inference ──

export function inferDaypart(startTime: string | null | undefined): Daypart {
  const hour = parseInt(String(startTime ?? '12').split(':')[0], 10);
  if (Number.isNaN(hour)) return 'afternoon';
  if (hour < 9) return 'opening';
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch_peak';
  if (hour < 20) return 'afternoon';
  return 'closing';
}

export function getDaypart(shift: ShiftView): Daypart {
  const explicit = String(shift.daypart ?? '').trim().toLowerCase();
  if (DAYPART_ORDER.includes(explicit as Daypart)) return explicit as Daypart;
  return inferDaypart(shift.startTime);
}

export function getDaypartLabel(daypart: Daypart): string {
  return DAYPART_LABELS[daypart] ?? daypart;
}

export function getWorkRoleLabel(role: string | null | undefined): string {
  return WORK_ROLE_LABELS[String(role ?? '').trim()] ?? String(role ?? '—');
}

export function getLiveStatusLabel(status: LiveStatus): string {
  return LIVE_STATUS_LABELS[status] ?? status;
}

// ── Time helpers ──

function parseShiftDateTime(date: string, shiftTime: string | null | undefined): Date | null {
  if (!shiftTime) return null;
  const timePart = String(shiftTime).trim().slice(0, 5);
  return new Date(`${date}T${timePart}:00`);
}

function diffMinutes(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function diffHoursFromTimes(startTime: string | null | undefined, endTime: string | null | undefined): number {
  const s = String(startTime ?? '').trim();
  const e = String(endTime ?? '').trim();
  if (!s || !e) return 0;
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

export function formatShiftTime(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 5) : '';
}

export function formatClockTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Live status derivation ──

export function deriveLiveStatus(
  assignment: WorkShiftView,
  shift: ShiftView,
  date: string,
  now: Date,
): LiveStatus {
  const schedStatus = String(assignment.scheduleStatus ?? '').trim().toLowerCase();
  const attStatus = String(assignment.attendanceStatus ?? '').trim().toLowerCase();

  if (schedStatus === 'cancelled') return 'cancelled';
  if (attStatus === 'leave') return 'on_leave';
  if (attStatus === 'absent') return 'no_show';
  if (assignment.actualEndTime) return 'completed';
  if (attStatus === 'late') return 'late';
  if (attStatus === 'present' || assignment.actualStartTime) return 'checked_in';

  // Still pending — derive from time
  const shiftStart = parseShiftDateTime(date, shift.startTime);
  if (!shiftStart) return 'assigned';

  if (now.getTime() > shiftStart.getTime() + NO_SHOW_THRESHOLD_MINUTES * 60000) return 'no_show';
  if (now.getTime() > shiftStart.getTime() + LATE_THRESHOLD_MINUTES * 60000) return 'late';
  if (now.getTime() > shiftStart.getTime()) return 'late';

  return schedStatus === 'confirmed' ? 'confirmed' : 'assigned';
}

// ── Shift progress ──

export function getShiftProgress(shift: ShiftView, date: string, now: Date): ShiftProgress {
  const start = parseShiftDateTime(date, shift.startTime);
  const end = parseShiftDateTime(date, shift.endTime);
  if (!start || !end) return 'not_started';
  if (now.getTime() > end.getTime()) return 'completed';
  if (now.getTime() >= start.getTime()) return 'in_progress';
  return 'not_started';
}

// ── Role coverage ──

export function computeRoleCoverage(
  shift: ShiftView,
  assignments: WorkShiftView[],
  date: string,
  now: Date,
): RoleCoverage[] {
  const roles = shift.roleRequirements ?? [];
  if (roles.length === 0) return [];

  return roles.map((req: RoleRequirementView) => {
    const roleAssignments = assignments.filter(
      (a) => String(a.workRole ?? '').trim() === req.workRole && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
    );
    const checkedIn = roleAssignments.filter((a) => {
      const live = deriveLiveStatus(a, shift, date, now);
      return live === 'checked_in' || live === 'late' || live === 'completed';
    });
    return {
      workRole: req.workRole,
      required: req.requiredCount,
      assigned: roleAssignments.length,
      checkedIn: checkedIn.length,
    };
  });
}

// ── Unfilled slots ──

export function computeUnfilledSlots(
  shift: ShiftView,
  assignments: WorkShiftView[],
): { workRole: string; gap: number }[] {
  const roles = shift.roleRequirements ?? [];
  const slots: { workRole: string; gap: number }[] = [];
  for (const req of roles) {
    const assigned = assignments.filter(
      (a) => String(a.workRole ?? '').trim() === req.workRole && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
    ).length;
    const gap = req.requiredCount - assigned;
    if (gap > 0) {
      slots.push({ workRole: req.workRole, gap });
    }
  }
  return slots;
}

// ── Exceptions derivation ──

export function deriveExceptions(
  shifts: ShiftView[],
  assignments: WorkShiftView[],
  date: string,
  now: Date,
): DerivedException[] {
  const issues: DerivedException[] = [];

  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  for (const a of assignments) {
    const shift = shiftMap.get(String(a.shiftId ?? ''));
    if (!shift) continue;
    const status = deriveLiveStatus(a, shift, date, now);

    const embeddedName = a.userFullName || a.userUsername || undefined;
    if (status === 'no_show') {
      issues.push({
        type: 'no_show',
        severity: 'critical',
        employeeId: a.userId ?? undefined,
        employeeName: embeddedName,
        workShiftId: a.id,
        shiftId: shift.id,
        shiftName: String(shift.name ?? ''),
        workRole: a.workRole ?? undefined,
        detail: 'No-Show',
      });
    } else if (status === 'late') {
      const shiftStart = parseShiftDateTime(date, shift.startTime);
      const clockIn = a.actualStartTime ? new Date(a.actualStartTime) : null;
      const delta = shiftStart && clockIn ? diffMinutes(shiftStart, clockIn) : 0;
      issues.push({
        type: 'late',
        severity: 'warning',
        employeeId: a.userId ?? undefined,
        employeeName: embeddedName,
        workShiftId: a.id,
        shiftId: shift.id,
        shiftName: String(shift.name ?? ''),
        workRole: a.workRole ?? undefined,
        detail: clockIn ? `Late +${delta}min` : 'Late (not clocked in)',
      });
    }
  }

  // Unfilled roles
  for (const shift of shifts) {
    const shiftAssignments = assignments.filter(
      (a) => String(a.shiftId ?? '') === shift.id && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
    );
    const unfilled = computeUnfilledSlots(shift, shiftAssignments);
    for (const slot of unfilled) {
      issues.push({
        type: 'unfilled',
        severity: 'warning',
        shiftId: shift.id,
        shiftName: String(shift.name ?? ''),
        workRole: slot.workRole,
        detail: `${slot.gap} unfilled`,
      });
    }
  }

  // Sort: critical first
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));

  return issues;
}

// ── Daily board metrics ──

export function computeDailyMetrics(
  shifts: ShiftView[],
  assignments: WorkShiftView[],
  date: string,
  now: Date,
): DailyBoardMetrics {
  const active = assignments.filter((a) => String(a.scheduleStatus ?? '').trim() !== 'cancelled');

  let onFloor = 0;
  let lateCount = 0;
  let noShowCount = 0;
  let pendingReview = 0;

  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  for (const a of active) {
    const shift = shiftMap.get(String(a.shiftId ?? ''));
    if (!shift) continue;
    const status = deriveLiveStatus(a, shift, date, now);
    if (status === 'checked_in') onFloor++;
    if (status === 'late') { lateCount++; onFloor++; }
    if (status === 'no_show') noShowCount++;
    if (String(a.approvalStatus ?? '').trim() === 'pending') pendingReview++;
  }

  const totalRequired = shifts.reduce((sum, s) => sum + (Number(s.headcountRequired) || 1), 0);

  return {
    onFloor,
    totalAssigned: active.length,
    coveragePercent: totalRequired > 0 ? Math.round((active.length / totalRequired) * 100) : 100,
    lateCount,
    noShowCount,
    pendingReview,
  };
}

// ── Daypart grouping ──

export interface DaypartGroup {
  daypart: Daypart;
  label: string;
  shifts: {
    shift: ShiftView;
    assignments: WorkShiftView[];
    roleCoverage: RoleCoverage[];
    unfilled: { workRole: string; gap: number }[];
    progress: ShiftProgress;
  }[];
}

export function groupByDaypart(
  shifts: ShiftView[],
  assignments: WorkShiftView[],
  date: string,
  now: Date,
): DaypartGroup[] {
  const groups = new Map<Daypart, DaypartGroup>();
  for (const dp of DAYPART_ORDER) {
    groups.set(dp, { daypart: dp, label: getDaypartLabel(dp), shifts: [] });
  }

  const sorted = [...shifts].sort((a, b) => {
    const ta = String(a.startTime ?? '99:99');
    const tb = String(b.startTime ?? '99:99');
    return ta.localeCompare(tb);
  });

  for (const shift of sorted) {
    const dp = getDaypart(shift);
    const shiftAssignments = assignments.filter(
      (a) => String(a.shiftId ?? '') === shift.id,
    );
    const group = groups.get(dp) ?? groups.get('afternoon')!;
    group.shifts.push({
      shift,
      assignments: shiftAssignments,
      roleCoverage: computeRoleCoverage(shift, shiftAssignments, date, now),
      unfilled: computeUnfilledSlots(shift, shiftAssignments),
      progress: getShiftProgress(shift, date, now),
    });
  }

  return DAYPART_ORDER.map((dp) => groups.get(dp)!).filter((g) => g.shifts.length > 0);
}

// ── Day summary for Labor Review ──

export function computeDaySummary(
  shifts: ShiftView[],
  assignments: WorkShiftView[],
  date: string,
): DaySummary {
  const dayAssignments = assignments.filter(
    (a) => a.workDate === date && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
  );
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  let scheduledHours = 0;
  let actualHours = 0;
  let lateCount = 0;
  let absentCount = 0;
  let approvedCount = 0;

  for (const a of dayAssignments) {
    const shift = shiftMap.get(String(a.shiftId ?? ''));
    if (shift) {
      scheduledHours += diffHoursFromTimes(shift.startTime, shift.endTime);
    }
    if (a.actualStartTime) {
      const start = new Date(a.actualStartTime);
      const end = a.actualEndTime ? new Date(a.actualEndTime) : new Date();
      actualHours += Math.max(0, (end.getTime() - start.getTime()) / 3600000);
    }
    const att = String(a.attendanceStatus ?? '').trim().toLowerCase();
    if (att === 'late') lateCount++;
    if (att === 'absent') absentCount++;
    if (String(a.approvalStatus ?? '').trim() === 'approved') approvedCount++;
  }

  const variance = actualHours - scheduledHours;
  const overtimeHours = Math.max(0, variance);

  return {
    date,
    scheduledHours: Math.round(scheduledHours * 100) / 100,
    actualHours: Math.round(actualHours * 100) / 100,
    variance: Math.round(variance * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    lateCount,
    absentCount,
    approvedCount,
    totalCount: dayAssignments.length,
    clockedOutCount: dayAssignments.filter((a) => !!a.actualEndTime).length,
  };
}

// ── Schedule planner coverage ──

export function computeWeekCoverage(
  shift: ShiftView,
  assignments: WorkShiftView[],
  date: string,
): { assigned: number; required: number; gap: number; overstaffed: boolean } {
  const dayAssignments = assignments.filter(
    (a) => String(a.shiftId ?? '') === shift.id && a.workDate === date && String(a.scheduleStatus ?? '').trim() !== 'cancelled',
  );
  const assigned = dayAssignments.length;
  // If headcountRequired is 1 (default) but more than 2 are assigned, treat required as actual assigned
  // to avoid false "overstaffed" warnings when the template wasn't configured
  const rawRequired = Number(shift.headcountRequired) || 1;
  const required = rawRequired;
  const overstaffed = rawRequired > 1 && assigned > rawRequired;
  return {
    assigned,
    required,
    gap: Math.max(0, required - assigned),
    overstaffed,
  };
}

// ── Status badge CSS classes ──

export function liveStatusBadgeClass(status: LiveStatus): string {
  switch (status) {
    case 'checked_in': return 'bg-green-100 text-green-800';
    case 'late': return 'bg-amber-100 text-amber-800';
    case 'no_show': return 'bg-red-100 text-red-800';
    case 'on_leave': return 'bg-blue-100 text-blue-800';
    case 'completed': return 'bg-gray-100 text-gray-600';
    case 'cancelled': return 'bg-gray-100 text-gray-400 line-through';
    case 'confirmed': return 'bg-sky-50 text-sky-700';
    default: return 'bg-gray-50 text-gray-600';
  }
}

export function progressBadgeClass(progress: ShiftProgress): string {
  switch (progress) {
    case 'in_progress': return 'bg-green-100 text-green-800';
    case 'completed': return 'bg-gray-100 text-gray-600';
    default: return 'bg-gray-50 text-gray-500';
  }
}

export function coverageTextClass(assigned: number, required: number): string {
  if (assigned === 0 && required > 0) return 'text-red-700';
  if (assigned < required) return 'text-amber-700';
  // When required=1 (unconfigured default) and many assigned, show neutral not green
  if (required <= 1 && assigned > 2) return 'text-sky-700';
  return 'text-green-700';
}

/** True when headcount_required is likely unconfigured (=1 default) but many assigned */
export function isHeadcountUnconfigured(required: number, assigned: number): boolean {
  return required <= 1 && assigned > 1;
}

export function severityBadgeClass(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-100 text-red-800';
    case 'warning': return 'bg-amber-100 text-amber-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}
