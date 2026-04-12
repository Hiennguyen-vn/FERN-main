import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Users,
  Clock,
  Search,
  ArrowLeftRight,
  CalendarDays,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { hrApi, type ShiftView, type WorkShiftView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

type SchedulingTab = 'shifts' | 'assignments' | 'time-off' | 'swaps';

const TABS: { key: SchedulingTab; label: string; icon: React.ElementType }[] = [
  { key: 'shifts', label: 'Shift Setup', icon: CalendarClock },
  { key: 'assignments', label: 'Work Assignments', icon: Users },
  { key: 'time-off', label: 'Time Off', icon: CalendarDays },
  { key: 'swaps', label: 'Swap Requests', icon: ArrowLeftRight },
];

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

export function SchedulingModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);

  const [activeTab, setActiveTab] = useState<SchedulingTab>('shifts');
  const [busyKey, setBusyKey] = useState('');

  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState('');
  const [shifts, setShifts] = useState<ShiftView[]>([]);
  const [shiftsTotal, setShiftsTotal] = useState(0);
  const [shiftsHasMore, setShiftsHasMore] = useState(false);

  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState('');
  const [workShifts, setWorkShifts] = useState<WorkShiftView[]>([]);
  const [assignmentsTotal, setAssignmentsTotal] = useState(0);
  const [assignmentsHasMore, setAssignmentsHasMore] = useState(false);

  const [createShiftForm, setCreateShiftForm] = useState({
    code: '',
    name: '',
    startTime: '09:00',
    endTime: '17:00',
    breakMinutes: '60',
  });

  const shiftsQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'name',
    initialSortDir: 'asc',
    initialFilters: { outletId: outletId || undefined },
  });
  const assignmentsQuery = useListQueryState<{
    outletId?: string;
    startDate?: string;
    endDate?: string;
  }>({
    initialLimit: 20,
    initialSortBy: 'workDate',
    initialSortDir: 'desc',
    initialFilters: {
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
    },
  });
  const patchShiftsFilters = shiftsQuery.patchFilters;
  const patchAssignmentsFilters = assignmentsQuery.patchFilters;

  const loadShifts = useCallback(async () => {
    if (!token) return;
    setShiftsLoading(true);
    setShiftsError('');
    try {
      const page = await hrApi.shiftsPaged(token, {
        ...shiftsQuery.query,
        outletId: outletId || undefined,
      });
      setShifts(page.items || []);
      setShiftsTotal(page.total || page.totalCount || 0);
      setShiftsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error) {
      console.error('Scheduling shifts load failed:', error);
      toast.error(getErrorMessage(error, 'Unable to load shifts from backend'));
      setShifts([]);
      setShiftsTotal(0);
      setShiftsHasMore(false);
      setShiftsError('Unable to load shifts');
    } finally {
      setShiftsLoading(false);
    }
  }, [outletId, shiftsQuery.query, token]);

  const loadAssignments = useCallback(async () => {
    if (!token) return;
    setAssignmentsLoading(true);
    setAssignmentsError('');
    try {
      const page = await hrApi.workShiftsPaged(token, {
        ...assignmentsQuery.query,
        outletId: outletId || undefined,
        startDate: dateFilter,
        endDate: dateFilter,
      });
      setWorkShifts(page.items || []);
      setAssignmentsTotal(page.total || page.totalCount || 0);
      setAssignmentsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error) {
      console.error('Scheduling assignments load failed:', error);
      toast.error(getErrorMessage(error, 'Unable to load assignments from backend'));
      setWorkShifts([]);
      setAssignmentsTotal(0);
      setAssignmentsHasMore(false);
      setAssignmentsError('Unable to load assignments');
    } finally {
      setAssignmentsLoading(false);
    }
  }, [assignmentsQuery.query, dateFilter, outletId, token]);

  useEffect(() => {
    patchShiftsFilters({ outletId: outletId || undefined });
    patchAssignmentsFilters({
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
    });
  }, [dateFilter, outletId, patchAssignmentsFilters, patchShiftsFilters]);

  useEffect(() => {
    if (activeTab !== 'shifts') return;
    void loadShifts();
  }, [activeTab, loadShifts]);

  useEffect(() => {
    if (activeTab !== 'assignments') return;
    void loadAssignments();
  }, [activeTab, loadAssignments]);

  const stats = useMemo(() => {
    const scheduled = workShifts.filter((row) => String(row.scheduleStatus || '').toLowerCase() === 'scheduled').length;
    const present = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'present').length;
    const late = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'late').length;
    const absent = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'absent').length;

    return {
      shiftCount: shiftsTotal,
      assignmentCount: assignmentsTotal,
      scheduled,
      present,
      late,
      absent,
    };
  }, [shiftsTotal, assignmentsTotal, workShifts]);

  const createShift = async () => {
    if (!token) return;
    if (!outletId) {
      toast.error('Select an outlet scope to create shifts');
      return;
    }
    if (!createShiftForm.name.trim() || !createShiftForm.startTime || !createShiftForm.endTime) {
      toast.error('Shift name and time are required');
      return;
    }

    setBusyKey('create-shift');
    try {
      await hrApi.createShift(token, {
        outletId,
        code: createShiftForm.code.trim() || null,
        name: createShiftForm.name.trim(),
        startTime: `${createShiftForm.startTime}:00`,
        endTime: `${createShiftForm.endTime}:00`,
        breakMinutes: Number(createShiftForm.breakMinutes || 0),
      });
      toast.success('Shift created');
      setCreateShiftForm({
        code: '',
        name: '',
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: '60',
      });
      await loadShifts();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create shift'));
    } finally {
      setBusyKey('');
    }
  };

  const updateAttendance = async (workShiftId: string, nextStatus: string) => {
    if (!token) return;
    setBusyKey(`attendance:${workShiftId}:${nextStatus}`);
    try {
      await hrApi.updateAttendance(token, workShiftId, {
        attendanceStatus: nextStatus,
        note: 'Updated from Scheduling module',
      });
      toast.success('Attendance updated');
      await loadAssignments();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to update attendance'));
    } finally {
      setBusyKey('');
    }
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Scheduling" />;
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
        <div className="surface-elevated p-4 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={activeTab === 'shifts' ? shiftsQuery.searchInput : assignmentsQuery.searchInput}
              onChange={(event) => {
                if (activeTab === 'shifts') {
                  shiftsQuery.setSearchInput(event.target.value);
                } else if (activeTab === 'assignments') {
                  assignmentsQuery.setSearchInput(event.target.value);
                }
              }}
              placeholder="Search by shift/user/status"
              className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Date</span>
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-xs"
            />
          </div>
          {activeTab === 'shifts' ? (
            <button
              onClick={() => void loadShifts()}
              disabled={shiftsLoading}
              className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', shiftsLoading ? 'animate-spin' : '')} />
              Refresh
            </button>
          ) : null}
          {activeTab === 'assignments' ? (
            <button
              onClick={() => void loadAssignments()}
              disabled={assignmentsLoading}
              className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', assignmentsLoading ? 'animate-spin' : '')} />
              Refresh
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: 'Shifts', value: stats.shiftCount, icon: CalendarClock },
            { label: 'Assignments', value: stats.assignmentCount, icon: Users },
            { label: 'Scheduled', value: stats.scheduled, icon: Clock },
            { label: 'Present', value: stats.present, icon: Clock },
            { label: 'Late', value: stats.late, icon: Clock },
            { label: 'Absent', value: stats.absent, icon: Clock },
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

        {activeTab === 'shifts' ? (
          <div className="space-y-4">
            <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Code</label>
                <input
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={createShiftForm.code}
                  onChange={(event) => setCreateShiftForm((prev) => ({ ...prev, code: event.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Name</label>
                <input
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={createShiftForm.name}
                  onChange={(event) => setCreateShiftForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Start</label>
                <input
                  type="time"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={createShiftForm.startTime}
                  onChange={(event) => setCreateShiftForm((prev) => ({ ...prev, startTime: event.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">End</label>
                <input
                  type="time"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={createShiftForm.endTime}
                  onChange={(event) => setCreateShiftForm((prev) => ({ ...prev, endTime: event.target.value }))}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => void createShift()}
                  disabled={busyKey === 'create-shift'}
                  className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60"
                >
                  {busyKey === 'create-shift' ? 'Creating...' : 'Create Shift'}
                </button>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              {shiftsError ? <p className="text-xs text-destructive">{shiftsError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Shift', 'Code', 'Name', 'Hours', 'Break (min)', 'Outlet'].map((header) => (
                        <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shiftsLoading && shifts.length === 0 ? (
                      <ListTableSkeleton columns={6} rows={6} />
                    ) : shifts.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No shifts found</td></tr>
                    ) : shifts.map((shift) => (
                      <tr key={String(shift.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(shift.id)}</td>
                        <td className="px-4 py-2.5 text-xs">{String(shift.code || '—')}</td>
                        <td className="px-4 py-2.5 text-sm">{String(shift.name || '—')}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(shift.startTime || '—')} - {String(shift.endTime || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(shift.breakMinutes ?? 0)}</td>
                        <td className="px-4 py-2.5 text-xs">{String(shift.outletId || '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPaginationControls
                total={shiftsTotal}
                limit={shiftsQuery.limit}
                offset={shiftsQuery.offset}
                hasMore={shiftsHasMore}
                disabled={shiftsLoading}
                onPageChange={shiftsQuery.setPage}
                onLimitChange={shiftsQuery.setPageSize}
              />
            </div>
          </div>
        ) : null}

        {activeTab === 'assignments' ? (
          <div className="surface-elevated p-4 space-y-3">
            {assignmentsError ? <p className="text-xs text-destructive">{assignmentsError}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Assignment', 'Date', 'User', 'Shift', 'Schedule', 'Attendance', 'Approval', 'Actions'].map((header) => (
                      <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assignmentsLoading && workShifts.length === 0 ? (
                    <ListTableSkeleton columns={8} rows={6} />
                  ) : workShifts.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No assignments found</td></tr>
                  ) : workShifts.map((assignment) => {
                    const id = String(assignment.id);
                    return (
                      <tr key={id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{id}</td>
                        <td className="px-4 py-2.5 text-xs">{String(assignment.workDate || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(assignment.userId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(assignment.shiftId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(assignment.scheduleStatus || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(assignment.attendanceStatus || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(assignment.approvalStatus || '—')}</td>
                        <td className="px-4 py-2.5 space-x-2">
                          <button
                            onClick={() => void updateAttendance(id, 'present')}
                            disabled={busyKey === `attendance:${id}:present`}
                            className="h-7 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                          >
                            Mark present
                          </button>
                          <button
                            onClick={() => void updateAttendance(id, 'late')}
                            disabled={busyKey === `attendance:${id}:late`}
                            className="h-7 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                          >
                            Mark late
                          </button>
                          <button
                            onClick={() => void updateAttendance(id, 'absent')}
                            disabled={busyKey === `attendance:${id}:absent`}
                            className="h-7 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                          >
                            Mark absent
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPaginationControls
              total={assignmentsTotal}
              limit={assignmentsQuery.limit}
              offset={assignmentsQuery.offset}
              hasMore={assignmentsHasMore}
              disabled={assignmentsLoading}
              onPageChange={assignmentsQuery.setPage}
              onLimitChange={assignmentsQuery.setPageSize}
            />
          </div>
        ) : null}

        {activeTab === 'time-off' ? (
          <EmptyState
            title="Time-off APIs are not exposed"
            description="The current backend contract does not provide time-off request endpoints for this screen."
          />
        ) : null}

        {activeTab === 'swaps' ? (
          <EmptyState
            title="Swap request APIs are not exposed"
            description="The current backend contract does not provide shift-swap request endpoints."
          />
        ) : null}
      </div>
    </div>
  );
}
