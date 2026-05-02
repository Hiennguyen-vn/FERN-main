import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Hourglass,
  RefreshCw,
  Search,
  Timer,
  TrendingUp,
  X,
  CalendarDays,
} from 'lucide-react';
import type {
  AuthUserListItem,
  ScopeOutlet,
  ShiftView,
  WorkShiftView,
} from '@/api/fern-api';
import { cn } from '@/lib/utils';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import {
  approvalBadgeClass,
  attendanceBadgeClass,
  formatHrEnumLabel,
  getHrOutletDisplay,
  getHrShiftDisplay,
  getHrUserDisplay,
  shortHrRef,
} from '@/components/hr/hr-display';
import {
  DeltaChip,
  DetailRow,
  ExceptionDot,
  KpiCard,
  KpiStrip,
  SegmentChip,
  getInitials,
} from '@/components/hr/hr-primitives';

type Segment = 'all' | 'attention' | 'late' | 'missed' | 'pending' | 'approved' | 'rejected';

interface QueryHandle {
  searchInput: string;
  setSearchInput: (v: string) => void;
  filters: { attendanceStatus?: string; approvalStatus?: string; [key: string]: unknown };
  setFilter: (key: string, value: unknown) => void;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  applySort: (field: string, direction: 'asc' | 'desc') => void;
  limit: number;
  offset: number;
  setPage: (next: number) => void;
  setPageSize: (next: number) => void;
}

export interface AttendanceWorkspaceProps {
  workShifts: WorkShiftView[];
  attendanceTotal: number;
  attendanceLoading: boolean;
  attendanceError: string;
  attendanceHasMore: boolean;
  attendanceQuery: QueryHandle;
  startDateFilter: string;
  endDateFilter: string;
  setStartDateFilter: (v: string) => void;
  setEndDateFilter: (v: string) => void;
  usersById: Map<string, AuthUserListItem>;
  outletsById: Map<string, ScopeOutlet>;
  shiftsById: Map<string, ShiftView>;
  loadAttendance: () => Promise<void>;
  approveAttendance: (id: string) => Promise<void>;
  bulkApprove: (ids: string[]) => Promise<void>;
  openRejectDialog: (id: string) => void;
  busyKey: string;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isLate(s: WorkShiftView) {
  return String(s.attendanceStatus || '').toLowerCase() === 'late';
}

function isMissedClockOut(s: WorkShiftView, shiftDef?: ShiftView) {
  if (s.actualEndTime) return false;
  const today = todayISO();
  const workDate = String(s.workDate || '').slice(0, 10);
  if (!workDate) return false;
  if (workDate < today) return true;
  if (workDate === today && shiftDef?.endTime) {
    const now = new Date();
    const end = new Date(shiftDef.endTime);
    if (Number.isFinite(end.getTime()) && now > end) return true;
  }
  return false;
}

function isOvertime(s: WorkShiftView) {
  return Number(s.totalHours ?? 0) > 8;
}

function isPending(s: WorkShiftView) {
  return String(s.approvalStatus || '').toLowerCase() === 'pending';
}

function isApproved(s: WorkShiftView) {
  return String(s.approvalStatus || '').toLowerCase() === 'approved';
}

function isRejected(s: WorkShiftView) {
  return String(s.approvalStatus || '').toLowerCase() === 'rejected';
}

function fmtTime(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return '—';
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return '—';
  const mins = Math.round((e - s) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function actualStartDelta(s: WorkShiftView, shiftDef?: ShiftView): { minutes: number; label: string; tone: 'late' | 'early' | 'ontime' | 'missing' } {
  if (!s.actualStartTime) return { minutes: 0, label: 'no clock-in', tone: 'missing' };
  if (!shiftDef?.startTime) return { minutes: 0, label: '—', tone: 'ontime' };
  const scheduled = new Date(shiftDef.startTime).getTime();
  const actual = new Date(s.actualStartTime).getTime();
  if (!Number.isFinite(scheduled) || !Number.isFinite(actual)) return { minutes: 0, label: '—', tone: 'ontime' };
  const diff = Math.round((actual - scheduled) / 60000);
  if (Math.abs(diff) <= 1) return { minutes: 0, label: 'on time', tone: 'ontime' };
  if (diff > 0) return { minutes: diff, label: `+${diff}m late`, tone: 'late' };
  return { minutes: diff, label: `${diff}m early`, tone: 'early' };
}

export function AttendanceWorkspace(props: AttendanceWorkspaceProps) {
  const {
    workShifts,
    attendanceTotal,
    attendanceLoading,
    attendanceError,
    attendanceHasMore,
    attendanceQuery,
    startDateFilter,
    endDateFilter,
    setStartDateFilter,
    setEndDateFilter,
    usersById,
    outletsById,
    shiftsById,
    loadAttendance,
    approveAttendance,
    bulkApprove,
    openRejectDialog,
    busyKey,
  } = props;

  const [segment, setSegment] = useState<Segment>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drawerShiftId, setDrawerShiftId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const counts = useMemo(() => {
    const all = workShifts.length;
    let late = 0;
    let missed = 0;
    let ot = 0;
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let totalHours = 0;
    for (const s of workShifts) {
      if (isLate(s)) late++;
      if (isMissedClockOut(s, shiftsById.get(String(s.shiftId)))) missed++;
      if (isOvertime(s)) ot++;
      if (isPending(s)) pending++;
      if (isApproved(s)) approved++;
      if (isRejected(s)) rejected++;
      totalHours += Number(s.totalHours ?? 0);
    }
    return { all, late, missed, ot, pending, approved, rejected, totalHours };
  }, [workShifts, shiftsById]);

  const filtered = useMemo(() => {
    return workShifts.filter((s) => {
      const shiftDef = shiftsById.get(String(s.shiftId));
      const exception = isLate(s) || isMissedClockOut(s, shiftDef) || isOvertime(s);
      switch (segment) {
        case 'all': return true;
        case 'attention': return exception;
        case 'late': return isLate(s);
        case 'missed': return isMissedClockOut(s, shiftDef);
        case 'pending': return isPending(s);
        case 'approved': return isApproved(s);
        case 'rejected': return isRejected(s);
      }
    });
  }, [workShifts, segment, shiftsById]);

  const groups = useMemo(() => {
    const map = new Map<string, WorkShiftView[]>();
    for (const s of filtered) {
      const key = String(s.userId ?? '_unassigned');
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return Array.from(map.entries()).map(([userId, shifts]) => {
      const sorted = [...shifts].sort((a, b) => String(a.workDate ?? '').localeCompare(String(b.workDate ?? '')));
      const totalHrs = sorted.reduce((sum, s) => sum + Number(s.totalHours ?? 0), 0);
      const lateCount = sorted.filter(isLate).length;
      const missedCount = sorted.filter((s) => isMissedClockOut(s, shiftsById.get(String(s.shiftId)))).length;
      const otCount = sorted.filter(isOvertime).length;
      const pendingClean = sorted.filter((s) => isPending(s) && !isLate(s) && !isMissedClockOut(s, shiftsById.get(String(s.shiftId))) && !isOvertime(s));
      return { userId, shifts: sorted, totalHrs, lateCount, missedCount, otCount, pendingClean };
    });
  }, [filtered, shiftsById]);

  const cleanShiftIds = useMemo(() => {
    return workShifts
      .filter((s) => {
        if (!isPending(s)) return false;
        const def = shiftsById.get(String(s.shiftId));
        return !isLate(s) && !isMissedClockOut(s, def) && !isOvertime(s);
      })
      .map((s) => String(s.id));
  }, [workShifts, shiftsById]);

  const drawerShift = useMemo(() => workShifts.find((s) => String(s.id) === drawerShiftId) ?? null, [workShifts, drawerShiftId]);
  const drawerShiftDef = drawerShift ? shiftsById.get(String(drawerShift.shiftId)) : undefined;
  const drawerUser = drawerShift ? getHrUserDisplay(usersById, drawerShift.userId) : null;
  const drawerOutlet = drawerShift ? getHrOutletDisplay(outletsById, drawerShift.outletId) : null;

  const toggleCollapse = (userId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const approveGroup = async (group: typeof groups[number]) => {
    if (group.pendingClean.length === 0) return;
    await bulkApprove(group.pendingClean.map((s) => String(s.id)));
  };

  const approveAllClean = async () => {
    if (cleanShiftIds.length === 0) return;
    setBulkBusy(true);
    try {
      await bulkApprove(cleanShiftIds);
    } finally {
      setBulkBusy(false);
    }
  };

  const today = todayISO();

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <KpiStrip cols={6}>
        <KpiCard icon={CalendarDays} label="Total shifts" value={counts.all} />
        <KpiCard icon={Clock} label="Pending" value={counts.pending} tone={counts.pending > 0 ? 'warn' : 'default'} />
        <KpiCard icon={AlertTriangle} label="Late" value={counts.late} tone={counts.late > 0 ? 'critical' : 'default'} />
        <KpiCard icon={Timer} label="Missed clock-out" value={counts.missed} tone={counts.missed > 0 ? 'critical' : 'default'} />
        <KpiCard icon={TrendingUp} label="Overtime" value={counts.ot} sub="shifts >8h" tone={counts.ot > 0 ? 'warn' : 'default'} />
        <KpiCard icon={Hourglass} label="Total hours" value={counts.totalHours.toFixed(1)} sub="hrs" />
      </KpiStrip>

      {/* Filter bar */}
      <div className="rounded-md border border-border/60 bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">From</span>
            <input
              type="date"
              value={startDateFilter}
              max={endDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">To</span>
            <input
              type="date"
              value={endDateFilter}
              min={startDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => { setStartDateFilter(today); setEndDateFilter(today); }}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              const day = d.getDay();
              const mon = new Date(d);
              mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
              const sun = new Date(mon);
              sun.setDate(mon.getDate() + 6);
              setStartDateFilter(mon.toISOString().slice(0, 10));
              setEndDateFilter(sun.toISOString().slice(0, 10));
            }}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent"
          >
            This week
          </button>

          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={attendanceQuery.searchInput}
              onChange={(e) => attendanceQuery.setSearchInput(e.target.value)}
              placeholder="Search employee, shift, note"
              className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
            />
          </div>

          <button
            type="button"
            onClick={() => void loadAttendance()}
            disabled={attendanceLoading}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', attendanceLoading ? 'animate-spin' : '')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Segments + bulk action */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentChip label="All" count={counts.all} active={segment === 'all'} onClick={() => setSegment('all')} />
        <SegmentChip label="Needs attention" count={counts.late + counts.missed + counts.ot} active={segment === 'attention'} tone="critical" onClick={() => setSegment('attention')} />
        <SegmentChip label="Late" count={counts.late} active={segment === 'late'} tone="critical" onClick={() => setSegment('late')} />
        <SegmentChip label="Missed clock-out" count={counts.missed} active={segment === 'missed'} tone="critical" onClick={() => setSegment('missed')} />
        <SegmentChip label="Pending review" count={counts.pending} active={segment === 'pending'} tone="warn" onClick={() => setSegment('pending')} />
        <SegmentChip label="Approved" count={counts.approved} active={segment === 'approved'} tone="success" onClick={() => setSegment('approved')} />
        <SegmentChip label="Rejected" count={counts.rejected} active={segment === 'rejected'} tone="critical" onClick={() => setSegment('rejected')} />

        {cleanShiftIds.length > 0 ? (
          <button
            type="button"
            onClick={() => void approveAllClean()}
            disabled={bulkBusy}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve {cleanShiftIds.length} clean shift{cleanShiftIds.length === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>

      {/* Error */}
      {attendanceError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {attendanceError}
        </div>
      ) : null}

      {/* List */}
      {attendanceLoading && workShifts.length === 0 ? (
        <div className="rounded-md border border-border/60 bg-card p-2">
          <ListTableSkeleton columns={4} rows={6} />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Clock className="mx-auto h-6 w-6 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">No shifts in this view</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a different segment or date range.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const userDisplay = getHrUserDisplay(usersById, group.userId);
            const isCollapsed = collapsed.has(group.userId);
            const initials = getInitials(userDisplay.primary);
            const hasException = group.lateCount > 0 || group.missedCount > 0;
            return (
              <div key={group.userId} className="overflow-hidden rounded-md border border-border/60 bg-card">
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggleCollapse(group.userId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                >
                  {isCollapsed
                    ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}

                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/15">
                    <span className="text-xs font-semibold tracking-tight text-primary">{initials}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{userDisplay.primary}</span>
                      {hasException ? (
                        <span className="inline-flex items-center gap-1">
                          {group.lateCount > 0 ? <ExceptionDot tone="critical" title={`${group.lateCount} late`} /> : null}
                          {group.missedCount > 0 ? <ExceptionDot tone="critical" title={`${group.missedCount} missed clock-out`} /> : null}
                          {group.otCount > 0 ? <ExceptionDot tone="warn" title={`${group.otCount} overtime`} /> : null}
                        </span>
                      ) : null}
                    </div>
                    {userDisplay.secondary ? (
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{userDisplay.secondary}</span>
                    ) : null}
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-5 text-right">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Shifts</p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{group.shifts.length}</p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Hours</p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{group.totalHrs.toFixed(1)}</p>
                    </div>
                  </div>

                  {group.pendingClean.length > 0 ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); void approveGroup(group); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); void approveGroup(group); } }}
                      className="inline-flex h-7 cursor-pointer flex-shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Approve {group.pendingClean.length}
                    </span>
                  ) : null}
                </button>

                {/* Shifts */}
                {!isCollapsed ? (
                  <div className="border-t border-border/60 bg-muted/20">
                    {group.shifts.map((shift, idx) => {
                      const def = shiftsById.get(String(shift.shiftId));
                      const shiftDisplay = getHrShiftDisplay(shiftsById, shift.shiftId);
                      const outletDisplay = getHrOutletDisplay(outletsById, shift.outletId);
                      const delta = actualStartDelta(shift, def);
                      const missed = isMissedClockOut(shift, def);
                      const ot = isOvertime(shift);
                      const pending = isPending(shift);
                      const id = String(shift.id);
                      const approveBusy = busyKey === `attendance:approve:${id}`;
                      const rejectBusy = busyKey === `attendance:reject:${id}`;
                      return (
                        <div
                          key={id}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-accent/40',
                            idx > 0 ? 'border-t border-border/40' : '',
                          )}
                          onClick={() => setDrawerShiftId(id)}
                        >
                          <div className="w-24 flex-shrink-0">
                            <p className="font-mono text-[10px] text-muted-foreground">{fmtDate(shift.workDate)}</p>
                            <p className="font-mono text-[10px] text-muted-foreground/70">#{shortHrRef(id)}</p>
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">{shiftDisplay.primary}</p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">
                              {def?.startTime && def?.endTime ? `${fmtTime(def.startTime)}–${fmtTime(def.endTime)}` : '—'}
                              {outletDisplay.primary ? ` · ${outletDisplay.primary}` : ''}
                            </p>
                          </div>

                          <div className="hidden w-32 flex-shrink-0 sm:block">
                            <p className="font-mono text-[10px] text-muted-foreground">Actual</p>
                            <p className="font-mono text-[11px] tabular-nums text-foreground">
                              {fmtTime(shift.actualStartTime)} → {missed ? <span className="text-destructive">missing</span> : fmtTime(shift.actualEndTime)}
                            </p>
                          </div>

                          <div className="hidden w-24 flex-shrink-0 md:block">
                            <DeltaChip tone={delta.tone} label={delta.label} />
                            {missed ? <div className="mt-1"><DeltaChip tone="missing" label="no clock-out" /></div> : null}
                            {ot ? <div className="mt-1"><DeltaChip tone="early" label="OT" /></div> : null}
                          </div>

                          <div className="flex w-24 flex-shrink-0 items-center gap-1.5">
                            <span className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-medium', attendanceBadgeClass(shift.attendanceStatus))}>
                              {formatHrEnumLabel(shift.attendanceStatus)}
                            </span>
                          </div>

                          <div className="flex w-20 flex-shrink-0 items-center gap-1.5">
                            <span className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-medium', approvalBadgeClass(shift.approvalStatus))}>
                              {formatHrEnumLabel(shift.approvalStatus)}
                            </span>
                          </div>

                          <div className="flex flex-shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {pending ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void approveAttendance(id)}
                                  disabled={approveBusy}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-emerald-600 transition-colors hover:bg-emerald-500/10 hover:border-emerald-500/40 disabled:opacity-50 dark:text-emerald-400"
                                  title="Approve"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openRejectDialog(id)}
                                  disabled={rejectBusy}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-destructive transition-colors hover:bg-destructive/10 hover:border-destructive/40 disabled:opacity-50"
                                  title="Reject"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </>
                            ) : (
                              <span className="font-mono text-[10px] text-muted-foreground">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer total */}
      {attendanceTotal > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-4 py-2 text-xs">
          <span className="font-mono text-muted-foreground">{attendanceTotal} shift{attendanceTotal === 1 ? '' : 's'}</span>
          <span className="font-mono text-muted-foreground">{counts.totalHours.toFixed(1)} hrs</span>
        </div>
      ) : null}

      {/* Drawer */}
      <Sheet open={drawerShift !== null} onOpenChange={(v) => { if (!v) setDrawerShiftId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          {drawerShift ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-sm">#{shortHrRef(drawerShift.id)}</SheetTitle>
                <SheetDescription>
                  {drawerUser?.primary ?? 'Unknown employee'}
                  {drawerUser?.secondary ? ` · ${drawerUser.secondary}` : ''}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1">
                <div className="rounded-md border border-border/60 bg-card p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Shift</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {getHrShiftDisplay(shiftsById, drawerShift.shiftId).primary}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {drawerShiftDef?.startTime && drawerShiftDef?.endTime
                      ? `${fmtTime(drawerShiftDef.startTime)} – ${fmtTime(drawerShiftDef.endTime)}`
                      : '—'}
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    {fmtDate(drawerShift.workDate)} · {drawerOutlet?.primary ?? '—'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-border/60 bg-card p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Scheduled</p>
                    <p className="mt-1 font-mono text-sm tabular-nums text-foreground">
                      {drawerShiftDef?.startTime ? fmtTime(drawerShiftDef.startTime) : '—'}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      → {drawerShiftDef?.endTime ? fmtTime(drawerShiftDef.endTime) : '—'}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-card p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Actual</p>
                    <p className="mt-1 font-mono text-sm tabular-nums text-foreground">{fmtTime(drawerShift.actualStartTime)}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">→ {fmtTime(drawerShift.actualEndTime)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <DetailRow label="Delta" value={<DeltaChip tone={actualStartDelta(drawerShift, drawerShiftDef).tone} label={actualStartDelta(drawerShift, drawerShiftDef).label} />} />
                  <DetailRow label="Duration" value={<span className="font-mono tabular-nums">{fmtDuration(drawerShift.actualStartTime, drawerShift.actualEndTime)}</span>} />
                  <DetailRow label="Total hours" value={<span className="font-mono tabular-nums">{Number(drawerShift.totalHours ?? 0).toFixed(2)}</span>} />
                  <DetailRow
                    label="Attendance"
                    value={<span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', attendanceBadgeClass(drawerShift.attendanceStatus))}>{formatHrEnumLabel(drawerShift.attendanceStatus)}</span>}
                  />
                  <DetailRow
                    label="Approval"
                    value={<span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', approvalBadgeClass(drawerShift.approvalStatus))}>{formatHrEnumLabel(drawerShift.approvalStatus)}</span>}
                  />
                  <DetailRow label="Note" value={<span className="text-foreground">{drawerShift.note || <span className="text-muted-foreground">—</span>}</span>} />
                </div>

                <div className="rounded-md border border-border/60 bg-card p-3 space-y-1.5">
                  <DetailRow label="Created" value={<span className="font-mono text-[11px]">{fmtDateTime(drawerShift.createdAt)}</span>} compact />
                  <DetailRow label="Updated" value={<span className="font-mono text-[11px]">{fmtDateTime(drawerShift.updatedAt)}</span>} compact />
                  <DetailRow label="Approved by" value={<span className="font-mono text-[11px]">{drawerShift.approvedByUserId ? shortHrRef(drawerShift.approvedByUserId) : '—'}</span>} compact />
                </div>
              </div>

              <SheetFooter className="mt-4 flex-row gap-2 border-t border-border/60 pt-4 sm:justify-end">
                {isPending(drawerShift) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => { void approveAttendance(String(drawerShift.id)); setDrawerShiftId(null); }}
                      disabled={Boolean(busyKey)}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 sm:flex-initial"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => { openRejectDialog(String(drawerShift.id)); setDrawerShiftId(null); }}
                      disabled={Boolean(busyKey)}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-4 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60 sm:flex-initial"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No actions available — record already {String(drawerShift.approvalStatus || '').toLowerCase()}.</p>
                )}
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

