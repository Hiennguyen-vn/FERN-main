import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import {
  buildOvertimeExceptionStats,
  compareOvertimeRows,
  hasTimesheetException,
  matchesOvertimeFocus,
  type OvertimeFocus,
  type OvertimeSortKey,
} from '@/components/workforce/overtime-exceptions';
import { planWorkShiftAssignments } from '@/components/workforce/work-shift-assignment';
import { buildShiftScheduleLanes } from '@/components/workforce/shift-schedule-board';

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

function formatShiftClock(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 5) : '';
}

function getShiftBoardTitle(shift?: ShiftView, fallbackLabel?: string) {
  const name = String(shift?.name ?? '').trim();
  const code = String(shift?.code ?? '').trim();
  if (name) return name;
  if (code) return code;
  return fallbackLabel || 'Shift unavailable';
}

function getShiftBoardMeta(shift?: ShiftView, fallbackId?: string) {
  if (!shift) {
    return fallbackId ? `Shift unavailable · ID ${fallbackId}` : 'Shift unavailable';
  }
  const parts = [];
  const timeRange = [formatShiftClock(shift.startTime), formatShiftClock(shift.endTime)].filter(Boolean).join(' - ');
  if (timeRange) parts.push(timeRange);
  const code = String(shift.code ?? '').trim();
  if (code) parts.push(code);
  parts.push(`Break ${Number(shift.breakMinutes ?? 0)} min`);
  return parts.join(' · ');
}

function getAttendanceBadgeLabel(value: string | null | undefined) {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'pending':
      return 'Attendance pending';
    case 'leave':
      return 'On leave';
    default:
      return formatHrEnumLabel(value);
  }
}

function getApprovalBadgeLabel(value: string | null | undefined) {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'pending':
      return 'Review pending';
    case 'approved':
      return 'Review approved';
    case 'rejected':
      return 'Review rejected';
    default:
      return formatHrEnumLabel(value);
  }
}

function getBoardIssueBadges(row: WorkShiftView) {
  const badges: Array<{ label: string; className: string }> = [];
  const scheduleStatus = String(row.scheduleStatus ?? '').trim().toLowerCase();
  const attendanceStatus = String(row.attendanceStatus ?? '').trim().toLowerCase();
  const approvalStatus = String(row.approvalStatus ?? '').trim().toLowerCase();

  if (scheduleStatus === 'cancelled') {
    badges.push({ label: 'Cancelled', className: scheduleBadgeClass(scheduleStatus) });
  }
  if (approvalStatus === 'pending') {
    badges.push({ label: 'Needs review', className: approvalBadgeClass(approvalStatus) });
  } else if (approvalStatus === 'rejected') {
    badges.push({ label: 'Review rejected', className: approvalBadgeClass(approvalStatus) });
  }
  if (attendanceStatus === 'pending') {
    badges.push({ label: 'Attendance pending', className: attendanceBadgeClass(attendanceStatus) });
  } else if (attendanceStatus === 'late') {
    badges.push({ label: 'Late', className: attendanceBadgeClass(attendanceStatus) });
  } else if (attendanceStatus === 'absent') {
    badges.push({ label: 'Absent', className: attendanceBadgeClass(attendanceStatus) });
  } else if (attendanceStatus === 'leave') {
    badges.push({ label: 'On leave', className: attendanceBadgeClass(attendanceStatus) });
  }

  return badges;
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
  const [assignmentSheetOpen, setAssignmentSheetOpen] = useState(false);
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
  const [dailyAssignments, setDailyAssignments] = useState<WorkShiftView[]>([]);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [attendanceHasMore, setAttendanceHasMore] = useState(false);

  const [overtimeLoading, setOvertimeLoading] = useState(false);
  const [overtimeError, setOvertimeError] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [timesheetsTotal, setTimesheetsTotal] = useState(0);
  const [timesheetsHasMore, setTimesheetsHasMore] = useState(false);
  const [overtimeFocus, setOvertimeFocus] = useState<OvertimeFocus>('all');

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
    attendanceStatus?: string;
    approvalStatus?: string;
  }>({
    initialLimit: 100,
    initialSortBy: 'userId',
    initialSortDir: 'asc',
    initialFilters: {
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
      scheduleStatus: undefined,
      attendanceStatus: undefined,
      approvalStatus: undefined,
    },
  });
  const overtimeQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'exceptionScore',
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
  const selectedShiftDisplay = useMemo(
    () => getHrShiftDisplay(shiftsById, assignmentDraft.shiftId),
    [assignmentDraft.shiftId, shiftsById],
  );
  const assignableUsers = useMemo(
    () => users.slice().sort((left, right) => (left.fullName || left.username).localeCompare(right.fullName || right.username)),
    [users],
  );
  const shiftBoardLanes = useMemo(() => buildShiftScheduleLanes(
    shifts.filter((shift) => String(shift.status || 'active').toLowerCase() !== 'inactive'),
    dailyAssignments,
  ), [dailyAssignments, shifts]);
  const selectedLane = useMemo(() => {
    if (shiftBoardLanes.length === 0) return null;
    return shiftBoardLanes.find((lane) => lane.shiftId === assignmentDraft.shiftId)
      ?? shiftBoardLanes.find((lane) => lane.isResolved)
      ?? shiftBoardLanes[0];
  }, [assignmentDraft.shiftId, shiftBoardLanes]);
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
  const existingAssignmentKeys = useMemo(
    () => new Set(dailyAssignments.map((row) => [String(row.shiftId || ''), String(row.userId || ''), String(row.workDate || '')].join(':'))),
    [dailyAssignments],
  );
  const duplicateSelectedUserIds = useMemo(() => {
    if (!assignmentDraft.shiftId || !assignmentDraft.workDate) return [];
    return assignmentDraft.userIds.filter((userId) => existingAssignmentKeys.has([
      String(assignmentDraft.shiftId || ''),
      String(userId || ''),
      String(assignmentDraft.workDate || ''),
    ].join(':')));
  }, [assignmentDraft.shiftId, assignmentDraft.userIds, assignmentDraft.workDate, existingAssignmentKeys]);
  const existingAssignmentsForSelectedShift = useMemo(
    () => dailyAssignments.filter((row) => String(row.shiftId || '') === String(assignmentDraft.shiftId || '')),
    [assignmentDraft.shiftId, dailyAssignments],
  );
  const existingUserIdsForSelectedShift = useMemo(
    () => new Set(existingAssignmentsForSelectedShift.map((row) => String(row.userId || '')).filter(Boolean)),
    [existingAssignmentsForSelectedShift],
  );
  const selectableVisibleUsers = useMemo(
    () => filteredAssignableUsers.filter((user) => !existingUserIdsForSelectedShift.has(user.id)),
    [existingUserIdsForSelectedShift, filteredAssignableUsers],
  );
  const allVisibleUsersSelected = useMemo(
    () => selectableVisibleUsers.length > 0
      && selectableVisibleUsers.every((user) => assignmentDraft.userIds.includes(user.id)),
    [assignmentDraft.userIds, selectableVisibleUsers],
  );
  const shiftBoardStats = useMemo(() => ({
    shiftCount: shiftBoardLanes.filter((lane) => lane.isResolved).length,
    employeeCount: new Set(dailyAssignments.map((row) => String(row.userId || '')).filter(Boolean)).size,
    assignmentCount: dailyAssignments.length,
    pendingReviewCount: dailyAssignments.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'pending').length,
  }), [dailyAssignments, shiftBoardLanes]);
  const attendanceDetailState = useMemo(() => {
    const searchTerm = attendanceQuery.searchInput.trim().toLowerCase();
    const rows = dailyAssignments.filter((row) => {
      const attendanceStatus = String(row.attendanceStatus || '').toLowerCase();
      const scheduleStatus = String(row.scheduleStatus || '').toLowerCase();
      const approvalStatus = String(row.approvalStatus || '').toLowerCase();
      if (attendanceQuery.filters.attendanceStatus && attendanceStatus !== String(attendanceQuery.filters.attendanceStatus).toLowerCase()) {
        return false;
      }
      if (attendanceQuery.filters.scheduleStatus && scheduleStatus !== String(attendanceQuery.filters.scheduleStatus).toLowerCase()) {
        return false;
      }
      if (attendanceQuery.filters.approvalStatus && approvalStatus !== String(attendanceQuery.filters.approvalStatus).toLowerCase()) {
        return false;
      }
      if (!searchTerm) return true;
      const userDisplay = getHrUserDisplay(usersById, row.userId);
      const shiftDisplay = getHrShiftDisplay(shiftsById, row.shiftId);
      const haystack = [
        row.id,
        row.userId,
        row.note,
        userDisplay.primary,
        userDisplay.secondary,
        shiftDisplay.primary,
        shiftDisplay.secondary,
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(searchTerm);
    });

    const sorted = rows.slice().sort((left, right) => {
      const direction = attendanceQuery.sortDir === 'asc' ? 1 : -1;
      switch (attendanceQuery.sortBy) {
        case 'approvalStatus':
          return String(left.approvalStatus || '').localeCompare(String(right.approvalStatus || '')) * direction
            || String(left.workDate || '').localeCompare(String(right.workDate || '')) * -1;
        case 'createdAt':
          return (new Date(String(right.createdAt || '')).getTime() - new Date(String(left.createdAt || '')).getTime()) * (direction === 1 ? -1 : 1);
        case 'workDate':
          return String(left.workDate || '').localeCompare(String(right.workDate || '')) * direction
            || String(left.id || '').localeCompare(String(right.id || '')) * -1;
        case 'userId':
        default: {
          const leftUser = getHrUserDisplay(usersById, left.userId).primary;
          const rightUser = getHrUserDisplay(usersById, right.userId).primary;
          return leftUser.localeCompare(rightUser) * direction
            || String(left.id || '').localeCompare(String(right.id || ''));
        }
      }
    });

    const total = sorted.length;
    const offset = attendanceQuery.offset;
    const limit = attendanceQuery.limit;
    return {
      total,
      hasMore: offset + limit < total,
      rows: sorted.slice(offset, offset + limit),
    };
  }, [
    attendanceQuery.filters.approvalStatus,
    attendanceQuery.filters.attendanceStatus,
    attendanceQuery.filters.scheduleStatus,
    attendanceQuery.limit,
    attendanceQuery.offset,
    attendanceQuery.searchInput,
    attendanceQuery.sortBy,
    attendanceQuery.sortDir,
    dailyAssignments,
    shiftsById,
    usersById,
  ]);

  const loadAttendance = useCallback(async () => {
    if (!token) return;
    setAttendanceLoading(true);
    setAttendanceError('');
    try {
      const byDate = outletId
        ? await hrApi.workShiftsByOutletDate(token, outletId, dateFilter)
        : [];
      setWorkShifts(byDate || []);
      setDailyAssignments(byDate || []);
      setAttendanceTotal((byDate || []).length);
      setAttendanceHasMore(false);
    } catch (error: unknown) {
      console.error('Workforce attendance load failed', error);
      setWorkShifts([]);
      setDailyAssignments([]);
      setAttendanceTotal(0);
      setAttendanceHasMore(false);
      setAttendanceError(getErrorMessage(error, 'Unable to load attendance rows'));
    } finally {
      setAttendanceLoading(false);
    }
  }, [
    dateFilter,
    outletId,
    token,
  ]);

  const loadOvertime = useCallback(async () => {
    if (!token) return;
    setOvertimeLoading(true);
    setOvertimeError('');
    try {
      const pageSize = 200;
      let offset = 0;
      let total = 0;
      const collected: PayrollTimesheetView[] = [];

      while (true) {
        const page = await payrollApi.timesheets(token, {
          outletId: outletId || undefined,
          sortBy: 'payrollPeriodEndDate',
          sortDir: 'desc',
          limit: pageSize,
          offset,
        });
        const items = page.items || [];
        collected.push(...items);
        total = page.total || page.totalCount || collected.length;

        const hasMore = Boolean(page.hasMore || page.hasNextPage) && items.length > 0 && collected.length < total;
        if (!hasMore) break;
        offset += pageSize;
      }

      setTimesheets(collected);
      setTimesheetsTotal(total || collected.length);
      setTimesheetsHasMore(false);
    } catch (error: unknown) {
      console.error('Workforce overtime load failed', error);
      setTimesheets([]);
      setTimesheetsTotal(0);
      setTimesheetsHasMore(false);
      setOvertimeError(getErrorMessage(error, 'Unable to load overtime rows'));
    } finally {
      setOvertimeLoading(false);
    }
  }, [outletId, token]);

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
    attendanceQuery.setPage(0);
    setAssignmentDraft((prev) => ({ ...prev, workDate: dateFilter }));
  }, [attendanceQuery.setPage, dateFilter, outletId, patchAttendanceFilters, patchLeaveFilters, patchOvertimeFilters]);

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
    const preferredShiftId = shiftBoardLanes.find((lane) => lane.isResolved)?.shiftId ?? shiftBoardLanes[0]?.shiftId ?? '';
    if (!preferredShiftId) {
      if (assignmentDraft.shiftId) {
        setAssignmentDraft((prev) => ({ ...prev, shiftId: '', userIds: [] }));
      }
      setAssignmentSheetOpen(false);
      return;
    }
    if (!shiftBoardLanes.some((lane) => lane.shiftId === assignmentDraft.shiftId)) {
      setAssignmentDraft((prev) => ({ ...prev, shiftId: preferredShiftId, userIds: [] }));
      setAssignmentSheetOpen(false);
    }
  }, [assignmentDraft.shiftId, shiftBoardLanes]);

  useEffect(() => {
    if (activeTab !== 'overtime') return;
    void loadOvertime();
  }, [activeTab, loadOvertime]);

  useEffect(() => {
    if (activeTab !== 'overtime') return;
    overtimeQuery.setPage(0);
  }, [activeTab, overtimeFocus, overtimeQuery.searchInput, overtimeQuery.sortBy, overtimeQuery.sortDir, overtimeQuery.setPage]);

  useEffect(() => {
    if (activeTab !== 'leave') return;
    void loadLeave();
  }, [activeTab, loadLeave]);

  const attendanceStats = useMemo(() => {
    const assigned = dailyAssignments.length;
    const scheduled = dailyAssignments.filter((row) => String(row.scheduleStatus || '').toLowerCase() === 'scheduled').length;
    const pendingAttendance = dailyAssignments.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'pending').length;
    const pendingReview = dailyAssignments.filter((row) => String(row.approvalStatus || '').toLowerCase() === 'pending').length;
    return { assigned, scheduled, pendingAttendance, pendingReview };
  }, [dailyAssignments]);

  const overtimeExceptionRows = useMemo(
    () => timesheets.filter(hasTimesheetException),
    [timesheets],
  );

  const overtimeFilteredRows = useMemo(() => {
    const searchTerm = overtimeQuery.searchInput.trim().toLowerCase();
    const sortBy = (overtimeQuery.sortBy || 'exceptionScore') as OvertimeSortKey | 'userId';
    const sortDir = overtimeQuery.sortDir === 'asc' ? 'asc' : 'desc';

    return overtimeExceptionRows
      .filter((row) => matchesOvertimeFocus(row, overtimeFocus))
      .filter((row) => {
        if (!searchTerm) return true;
        const userDisplay = getHrUserDisplay(usersById, row.userId);
        const outletDisplay = getHrOutletDisplay(outletsById, row.outletId);
        const haystack = [
          row.id,
          row.userId,
          row.outletId,
          userDisplay.primary,
          userDisplay.secondary,
          outletDisplay.primary,
          outletDisplay.secondary,
          formatPeriodLabel(
            row.payrollPeriodName,
            row.payrollPeriodStartDate,
            row.payrollPeriodEndDate,
            row.payrollPeriodId,
          ),
        ]
          .map((value) => String(value ?? '').toLowerCase())
          .join(' ');
        return haystack.includes(searchTerm);
      })
      .sort((left, right) => {
        if (sortBy === 'userId') {
          const leftUser = getHrUserDisplay(usersById, left.userId).primary;
          const rightUser = getHrUserDisplay(usersById, right.userId).primary;
          return sortDir === 'asc'
            ? leftUser.localeCompare(rightUser) || String(left.id || '').localeCompare(String(right.id || ''))
            : rightUser.localeCompare(leftUser) || String(right.id || '').localeCompare(String(left.id || ''));
        }
        return compareOvertimeRows(left, right, sortBy, sortDir);
      });
  }, [
    overtimeExceptionRows,
    overtimeFocus,
    overtimeQuery.searchInput,
    overtimeQuery.sortBy,
    overtimeQuery.sortDir,
    outletsById,
    usersById,
  ]);

  const overtimeDetailState = useMemo(() => {
    const total = overtimeFilteredRows.length;
    const offset = overtimeQuery.offset;
    const limit = overtimeQuery.limit;
    return {
      total,
      hasMore: offset + limit < total,
      rows: overtimeFilteredRows.slice(offset, offset + limit),
    };
  }, [overtimeFilteredRows, overtimeQuery.limit, overtimeQuery.offset]);

  const overtimeStats = useMemo(
    () => buildOvertimeExceptionStats(overtimeFilteredRows),
    [overtimeFilteredRows],
  );

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
    if (!selectedLane?.isResolved) {
      toast.error('Choose an active shift template before assigning employees');
      return;
    }
    let plan;
    try {
      plan = planWorkShiftAssignments(
        assignmentDraft,
        dailyAssignments.map((row) => ({
          shiftId: String(row.shiftId || ''),
          userId: String(row.userId || ''),
          workDate: String(row.workDate || ''),
        })),
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to prepare shift assignments'));
      return;
    }
    if (plan.payloads.length === 0 && plan.duplicateUserIds.length > 0) {
      toast.error(
        plan.duplicateUserIds.length === 1
          ? 'Selected employee already has this shift on the chosen date'
          : `${plan.duplicateUserIds.length} selected employees already have this shift on the chosen date`,
      );
      await loadAttendance();
      return;
    }
    setBusyKey('assign-work-shift');
    try {
      const failures: string[] = [];
      let successCount = 0;
      for (const payload of plan.payloads) {
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
            : `${failures.length} assignments failed. First error: ${failures[0]}`,
        );
      }
      if (plan.duplicateUserIds.length > 0) {
        toast.error(
          plan.duplicateUserIds.length === 1
            ? '1 selected employee was skipped because the assignment already exists'
            : `${plan.duplicateUserIds.length} selected employees were skipped because the assignment already exists`,
        );
      }
      setAssignmentDraft((prev) => ({
        ...prev,
        userIds: [],
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
      const visibleIds = selectableVisibleUsers.map((user) => user.id);
      if (visibleIds.length === 0) return prev;
      const nextIds = allVisibleUsersSelected
        ? prev.userIds.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...prev.userIds, ...visibleIds]));
      return { ...prev, userIds: nextIds };
    });
  };

  const openAssignmentSheet = (shiftId: string) => {
    setAssignmentUserQuery('');
    setAssignmentDraft((prev) => ({
      ...prev,
      shiftId,
      workDate: dateFilter,
      userIds: [],
      note: '',
    }));
    setAssignmentSheetOpen(true);
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
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Daily shift board</h2>
                  <p className="text-xs text-muted-foreground">Plan assignments by time window for {formatDate(dateFilter)} at {currentOutletDisplay.primary}.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(event) => setDateFilter(event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  />
                  <button
                    onClick={() => void loadAttendance()}
                    disabled={attendanceLoading}
                    className="flex h-8 items-center gap-1 rounded border px-2.5 text-[11px] hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', attendanceLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                  <Link
                    to="/scheduling"
                    className="flex h-8 items-center rounded border px-2.5 text-[11px] hover:bg-accent"
                  >
                    Manage shift templates
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'Shift Templates', value: shiftBoardStats.shiftCount, icon: Clock },
                  { label: 'Employees Scheduled', value: shiftBoardStats.employeeCount, icon: UserCheck },
                  { label: 'Assignments', value: shiftBoardStats.assignmentCount, icon: CheckCircle2 },
                  { label: 'Needs Review', value: shiftBoardStats.pendingReviewCount, icon: AlertTriangle },
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

              {attendanceError ? <p className="text-xs text-destructive">{attendanceError}</p> : null}

              {shiftBoardLanes.length === 0 ? (
                <EmptyState
                  title="No shift templates"
                  description="Create shift templates for this outlet before planning daily assignments."
                />
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {shiftBoardLanes.map((lane) => {
                    const shiftDisplay = getHrShiftDisplay(shiftsById, lane.shiftId);
                    const laneTitle = getShiftBoardTitle(lane.shift, shiftDisplay.primary);
                    const laneMeta = getShiftBoardMeta(lane.shift, lane.shiftId);
                    const laneAssignments = lane.assignments.slice().sort((left, right) => {
                      const leftDisplay = getHrUserDisplay(usersById, left.userId);
                      const rightDisplay = getHrUserDisplay(usersById, right.userId);
                      return leftDisplay.primary.localeCompare(rightDisplay.primary);
                    });
                    const previewAssignments = laneAssignments.slice(0, 4);
                    const hiddenAssignmentsCount = Math.max(0, laneAssignments.length - previewAssignments.length);
                    const isSelected = assignmentSheetOpen && assignmentDraft.shiftId === lane.shiftId;
                    const isEmptyLane = laneAssignments.length === 0;
                    return (
                      <article
                        key={lane.shiftId}
                        className={cn(
                          'rounded-2xl border bg-background/70 p-4',
                          isSelected ? 'border-primary ring-1 ring-primary/20' : 'border-border',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="text-base font-semibold">{laneTitle}</p>
                            <p className="text-xs text-muted-foreground">{laneMeta}</p>
                          </div>
                          <button
                            onClick={() => openAssignmentSheet(lane.shiftId)}
                            disabled={!lane.isResolved}
                            className={cn(
                              'h-8 rounded-md border px-2.5 text-[11px] font-medium',
                              isSelected ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-accent',
                              !lane.isResolved ? 'opacity-50 cursor-not-allowed' : '',
                            )}
                          >
                            {lane.isResolved ? (isSelected ? 'Assigning here' : 'Assign employees') : 'Unavailable'}
                          </button>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium bg-muted/60 text-foreground border-border">
                            {lane.summary.assignedCount} assigned
                          </span>
                          {lane.summary.pendingReviewCount > 0 ? (
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', approvalBadgeClass('pending'))}>
                              Needs review {lane.summary.pendingReviewCount}
                            </span>
                          ) : null}
                          {lane.summary.attendancePendingCount > 0 ? (
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('pending'))}>
                              Attendance pending {lane.summary.attendancePendingCount}
                            </span>
                          ) : null}
                          {lane.summary.lateCount > 0 ? (
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('late'))}>
                              Late {lane.summary.lateCount}
                            </span>
                          ) : null}
                          {lane.summary.absentCount > 0 ? (
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('absent'))}>
                              Absent {lane.summary.absentCount}
                            </span>
                          ) : null}
                          {lane.summary.leaveCount > 0 ? (
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('leave'))}>
                              Leave {lane.summary.leaveCount}
                            </span>
                          ) : null}
                        </div>

                        {isEmptyLane ? (
                          <div className="mt-4 rounded-xl border border-dashed bg-background/70 px-3 py-4 text-xs text-muted-foreground">
                            No employees assigned to this shift yet
                          </div>
                        ) : (
                          <div className="mt-4 rounded-xl border bg-background">
                            <div className="divide-y">
                              {previewAssignments.map((row) => {
                                const userDisplay = getHrUserDisplay(usersById, row.userId);
                                const issueBadges = getBoardIssueBadges(row);
                                return (
                                  <div key={String(row.id)} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium">{userDisplay.primary}</p>
                                      {userDisplay.secondary ? (
                                        <p className="text-[11px] text-muted-foreground">{userDisplay.secondary}</p>
                                      ) : null}
                                    </div>
                                    {issueBadges.length > 0 ? (
                                      <div className="flex flex-wrap justify-end gap-1.5">
                                        {issueBadges.map((badge) => (
                                          <span
                                            key={`${row.id}:${badge.label}`}
                                            className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', badge.className)}
                                          >
                                            {badge.label}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                            {hiddenAssignmentsCount > 0 ? (
                              <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
                                +{hiddenAssignmentsCount} more employees in this shift
                              </div>
                            ) : null}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="surface-elevated space-y-4 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Assignments for {formatDate(dateFilter)} ({attendanceDetailState.total})</h2>
                  <p className="text-xs text-muted-foreground">Search persisted work shift rows, then review schedule or attendance state as needed.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[240px] flex-1 xl:w-72 xl:flex-none">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={attendanceQuery.searchInput}
                      onChange={(event) => attendanceQuery.setSearchInput(event.target.value)}
                      placeholder="Search employee, shift, note, assignment id"
                      className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                    />
                  </div>
                  <select
                    value={attendanceQuery.filters.attendanceStatus || 'all'}
                    onChange={(event) => attendanceQuery.setFilter('attendanceStatus', event.target.value === 'all' ? undefined : event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="all">All attendance</option>
                    <option value="pending">Attendance pending</option>
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                    <option value="leave">Leave</option>
                  </select>
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
                    value={`${attendanceQuery.sortBy || 'userId'}:${attendanceQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      attendanceQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="userId:asc">Employee A-Z</option>
                    <option value="approvalStatus:asc">Pending review first</option>
                    <option value="createdAt:desc">Last created</option>
                    <option value="workDate:desc">Latest work date</option>
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
                    {attendanceLoading && attendanceDetailState.rows.length === 0 ? (
                      <ListTableSkeleton columns={8} rows={6} />
                    ) : attendanceDetailState.rows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          No assignments match the selected detail filters
                        </td>
                      </tr>
                    ) : attendanceDetailState.rows.map((row) => {
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
                              {shiftDisplay.secondary ? (
                                <span className="text-[11px] text-muted-foreground">{shiftDisplay.secondary}</span>
                              ) : null}
                              <span className="text-[11px] text-muted-foreground">{outletDisplay.primary}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', scheduleBadgeClass(scheduleStatus))}>
                              {formatHrEnumLabel(scheduleStatus)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass(attendanceStatus))}>
                              {getAttendanceBadgeLabel(attendanceStatus)}
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
                              {getApprovalBadgeLabel(approvalStatus)}
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
                total={attendanceDetailState.total}
                limit={attendanceQuery.limit}
                offset={attendanceQuery.offset}
                hasMore={attendanceDetailState.hasMore}
                disabled={attendanceLoading}
                onPageChange={attendanceQuery.setPage}
                onLimitChange={attendanceQuery.setPageSize}
              />
            </section>
          </div>
        ) : null}

        <Sheet
          open={activeTab === 'attendance' && assignmentSheetOpen && Boolean(selectedLane)}
          onOpenChange={(open) => {
            setAssignmentSheetOpen(open);
            if (!open) {
              setAssignmentUserQuery('');
              setAssignmentDraft((prev) => ({ ...prev, userIds: [], note: '' }));
            }
          }}
        >
          {selectedLane ? (
            <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
              <SheetHeader className="border-b px-6 py-5">
                <SheetTitle className="text-base">Assign employees</SheetTitle>
                <SheetDescription>
                  {getShiftBoardTitle(selectedLane.shift, selectedShiftDisplay.primary)} · {getShiftBoardMeta(selectedLane.shift, selectedLane.shiftId)}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 px-6 py-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Work date</p>
                    <p className="mt-1 text-sm font-semibold">{formatDate(assignmentDraft.workDate)}</p>
                  </div>
                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Already assigned</p>
                    <p className="mt-1 text-sm font-semibold">{selectedLane.summary.assignedCount}</p>
                  </div>
                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Outlet</p>
                    <p className="mt-1 text-sm font-semibold">{currentOutletDisplay.primary}</p>
                  </div>
                </div>

                <div className="rounded-2xl border bg-background">
                  <div className="border-b px-4 py-4">
                    <label className="space-y-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Shared note</span>
                      <input
                        value={assignmentDraft.note}
                        onChange={(event) => setAssignmentDraft((prev) => ({ ...prev, note: event.target.value }))}
                        placeholder="Optional note for all selected employees"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', scheduleBadgeClass('scheduled'))}>Scheduled</span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('pending'))}>Attendance pending</span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', approvalBadgeClass('pending'))}>Review pending</span>
                    </div>
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Backend writes one `work_shift` record per selected employee. Existing duplicates are marked and skipped before submit.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div className="relative min-w-[240px] flex-1">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={assignmentUserQuery}
                        onChange={(event) => setAssignmentUserQuery(event.target.value)}
                        placeholder="Search employee name, username, employee code"
                        className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{assignmentDraft.userIds.length} selected</span>
                      <button
                        onClick={toggleAllVisibleAssignmentUsers}
                        type="button"
                        disabled={selectableVisibleUsers.length === 0}
                        className="rounded border px-2 py-1 hover:bg-accent"
                      >
                        {allVisibleUsersSelected ? 'Clear visible' : 'Select visible'}
                      </button>
                    </div>
                  </div>

                  {duplicateSelectedUserIds.length > 0 ? (
                    <div className="border-b px-4 py-2 text-[11px] text-amber-700">
                      {duplicateSelectedUserIds.length} selected employees already have this shift on this date and will be skipped.
                    </div>
                  ) : null}

                  <div className="max-h-[50vh] overflow-y-auto">
                    {filteredAssignableUsers.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-muted-foreground">No employees match this search</div>
                    ) : (
                      filteredAssignableUsers.map((user) => {
                        const display = getHrUserDisplay(usersById, user.id);
                        const checked = assignmentDraft.userIds.includes(user.id);
                        const alreadyAssigned = existingUserIdsForSelectedShift.has(user.id);
                        return (
                          <label
                            key={user.id}
                            className={cn(
                              'flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0',
                              alreadyAssigned ? 'bg-muted/30' : 'cursor-pointer hover:bg-accent/40',
                            )}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{display.primary}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {[display.secondary, currentOutletDisplay.primary].filter(Boolean).join(' · ')}
                              </p>
                              {alreadyAssigned ? (
                                <p className="mt-1 text-[11px] text-amber-700">Already assigned to this shift on {formatDate(assignmentDraft.workDate)}</p>
                              ) : null}
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={alreadyAssigned}
                              onChange={() => {
                                if (!alreadyAssigned) toggleAssignmentUser(user.id);
                              }}
                              className="h-4 w-4 rounded border-input"
                            />
                          </label>
                        );
                      })
                    )}
                  </div>

                  <div className="flex flex-col gap-3 border-t px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <p className="text-[11px] text-muted-foreground">
                      Use this panel to assign more employees to the same shift without leaving the board.
                    </p>
                    <button
                      onClick={() => void assignWorkShift()}
                      disabled={busyKey === 'assign-work-shift' || !selectedLane.isResolved || assignmentDraft.userIds.length === 0}
                      className="h-10 rounded-md bg-primary px-4 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {busyKey === 'assign-work-shift'
                        ? 'Assigning...'
                        : assignmentDraft.userIds.length > 1
                          ? `Assign ${assignmentDraft.userIds.length} Employees`
                          : 'Assign Employees'}
                    </button>
                  </div>
                </div>
              </div>
            </SheetContent>
          ) : null}
        </Sheet>

        {activeTab === 'overtime' ? (
          <div className="space-y-4">
            <section className="surface-elevated space-y-4 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Overtime, lateness, and absence ({overtimeDetailState.total})</h2>
                  <p className="text-xs text-muted-foreground">
                    Review payroll timesheet exceptions for {currentOutletDisplay.primary}. This view combines overtime,
                    late events, and absent days from the selected outlet scope.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[240px] flex-1 xl:w-72 xl:flex-none">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={overtimeQuery.searchInput}
                      onChange={(event) => overtimeQuery.setSearchInput(event.target.value)}
                      placeholder="Search employee, employee code, period, timesheet"
                      className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                    />
                  </div>
                  <select
                    value={overtimeFocus}
                    onChange={(event) => setOvertimeFocus(event.target.value as OvertimeFocus)}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="all">All exceptions</option>
                    <option value="overtime">Overtime only</option>
                    <option value="late">Late only</option>
                    <option value="absent">Absent only</option>
                    <option value="mixed">Multi-signal</option>
                  </select>
                  <select
                    value={`${overtimeQuery.sortBy || 'exceptionScore'}:${overtimeQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      overtimeQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                    className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="exceptionScore:desc">Impact first</option>
                    <option value="overtimeHours:desc">Most overtime</option>
                    <option value="lateCount:desc">Most late</option>
                    <option value="absentDays:desc">Most absent</option>
                    <option value="payrollPeriodEndDate:desc">Latest period</option>
                    <option value="userId:asc">Employee A-Z</option>
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

              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  { label: 'Exception Rows', value: overtimeStats.rowCount, icon: AlertTriangle },
                  { label: 'Employees Affected', value: overtimeStats.affectedEmployeeCount, icon: UserCheck },
                  { label: 'OT Hours', value: overtimeStats.overtimeHours.toFixed(2), icon: Timer },
                  { label: 'Late Events', value: overtimeStats.lateCount, icon: TrendingUp },
                  { label: 'Absent Days', value: overtimeStats.absentDays.toFixed(2), icon: UserX },
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

              {overtimeStats.rowCount > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    OT rows {overtimeStats.overtimeRowCount}
                  </span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    Late rows {overtimeStats.lateRowCount}
                  </span>
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                    Absent rows {overtimeStats.absentRowCount}
                  </span>
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                    Multi-signal rows {overtimeStats.mixedRowCount}
                  </span>
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Timesheet', 'Employee', 'Period', 'Workload', 'Signals'].map((header) => (
                        <th key={header} className="px-4 py-2.5 text-left text-[11px]">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overtimeLoading && timesheets.length === 0 ? (
                      <ListTableSkeleton columns={5} rows={6} />
                    ) : overtimeDetailState.rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          No exception rows match the selected filters
                        </td>
                      </tr>
                    ) : overtimeDetailState.rows.map((row) => {
                      const userDisplay = getHrUserDisplay(usersById, row.userId);
                      const periodRange = row.payrollPeriodStartDate && row.payrollPeriodEndDate
                        ? `${row.payrollPeriodStartDate} → ${row.payrollPeriodEndDate}`
                        : null;
                      return (
                        <tr key={String(row.id)} className="border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{shortHrRef(row.id)}</span>
                              <span className="text-[11px] text-muted-foreground">{formatDate(row.updatedAt || row.createdAt)}</span>
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
                          <td className="px-4 py-2.5 text-xs">
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">
                                {formatPeriodLabel(
                                  row.payrollPeriodName,
                                  row.payrollPeriodStartDate,
                                  row.payrollPeriodEndDate,
                                  row.payrollPeriodId,
                                )}
                              </span>
                              {periodRange ? (
                                <span className="text-[11px] text-muted-foreground">{periodRange}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <div className="flex flex-col">
                              <span>{toNumber(row.workDays).toFixed(2)} work days</span>
                              <span>{toNumber(row.workHours).toFixed(2)} logged hours</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col gap-2">
                              <div className="flex flex-wrap gap-2">
                                {toNumber(row.overtimeHours) > 0 ? (
                                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                    +{toNumber(row.overtimeHours).toFixed(2)}h overtime
                                  </span>
                                ) : null}
                                {toNumber(row.lateCount) > 0 ? (
                                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('late'))}>
                                    {toNumber(row.lateCount)} late
                                  </span>
                                ) : null}
                                {toNumber(row.absentDays) > 0 ? (
                                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass('absent'))}>
                                    {toNumber(row.absentDays).toFixed(2)} absent days
                                  </span>
                                ) : null}
                              </div>
                              {toNumber(row.overtimeHours) > 0 ? (
                                <p className="text-[11px] text-muted-foreground">
                                  OT multiplier ×{toNumber(row.overtimeRate).toFixed(2)}
                                </p>
                              ) : (
                                <p className="text-[11px] text-muted-foreground">No overtime multiplier applied</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ListPaginationControls
                total={overtimeDetailState.total}
                limit={overtimeQuery.limit}
                offset={overtimeQuery.offset}
                hasMore={overtimeDetailState.hasMore}
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
                              {shiftDisplay.secondary ? (
                                <span className="text-[11px] text-muted-foreground">{shiftDisplay.secondary}</span>
                              ) : null}
                              <span className="text-[11px] text-muted-foreground">{outletDisplay.primary}</span>
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
