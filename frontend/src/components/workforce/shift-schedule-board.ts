import type { ShiftView, WorkShiftView } from '@/api/fern-api';

export interface ShiftScheduleLaneSummary {
  assignedCount: number;
  pendingReviewCount: number;
  attendancePendingCount: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  leaveCount: number;
}

export interface ShiftScheduleLane {
  shiftId: string;
  shift?: ShiftView;
  assignments: WorkShiftView[];
  isResolved: boolean;
  summary: ShiftScheduleLaneSummary;
}

function normalizeValue(value: string | null | undefined) {
  return String(value ?? '').trim();
}

function getShiftSortKey(shift?: ShiftView, fallbackId = '') {
  return [
    normalizeValue(shift?.startTime) || '99:99:99',
    normalizeValue(shift?.code) || normalizeValue(shift?.name) || fallbackId,
  ].join('|');
}

function buildLaneSummary(assignments: WorkShiftView[]): ShiftScheduleLaneSummary {
  return {
    assignedCount: assignments.length,
    pendingReviewCount: assignments.filter((row) => normalizeValue(row.approvalStatus).toLowerCase() === 'pending').length,
    attendancePendingCount: assignments.filter((row) => normalizeValue(row.attendanceStatus).toLowerCase() === 'pending').length,
    presentCount: assignments.filter((row) => normalizeValue(row.attendanceStatus).toLowerCase() === 'present').length,
    lateCount: assignments.filter((row) => normalizeValue(row.attendanceStatus).toLowerCase() === 'late').length,
    absentCount: assignments.filter((row) => normalizeValue(row.attendanceStatus).toLowerCase() === 'absent').length,
    leaveCount: assignments.filter((row) => normalizeValue(row.attendanceStatus).toLowerCase() === 'leave').length,
  };
}

export function buildShiftScheduleLanes(shifts: ShiftView[], assignments: WorkShiftView[]): ShiftScheduleLane[] {
  const assignmentsByShiftId = new Map<string, WorkShiftView[]>();
  for (const row of assignments) {
    const shiftId = normalizeValue(row.shiftId);
    if (!shiftId) continue;
    const bucket = assignmentsByShiftId.get(shiftId) ?? [];
    bucket.push(row);
    assignmentsByShiftId.set(shiftId, bucket);
  }

  const sortedShifts = shifts
    .slice()
    .sort((left, right) => getShiftSortKey(left, left.id).localeCompare(getShiftSortKey(right, right.id)));

  const knownShiftIds = new Set(sortedShifts.map((shift) => normalizeValue(shift.id)));
  const lanes: ShiftScheduleLane[] = sortedShifts.map((shift) => {
    const shiftId = normalizeValue(shift.id);
    const shiftAssignments = assignmentsByShiftId.get(shiftId) ?? [];
    return {
      shiftId,
      shift,
      assignments: shiftAssignments,
      isResolved: true,
      summary: buildLaneSummary(shiftAssignments),
    };
  });

  const unresolvedShiftIds = Array.from(assignmentsByShiftId.keys())
    .filter((shiftId) => !knownShiftIds.has(shiftId))
    .sort((left, right) => left.localeCompare(right));

  for (const shiftId of unresolvedShiftIds) {
    const shiftAssignments = assignmentsByShiftId.get(shiftId) ?? [];
    lanes.push({
      shiftId,
      shift: undefined,
      assignments: shiftAssignments,
      isResolved: false,
      summary: buildLaneSummary(shiftAssignments),
    });
  }

  return lanes;
}
