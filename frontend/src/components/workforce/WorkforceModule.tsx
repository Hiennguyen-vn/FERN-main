import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  UserCheck,
  UserX,
  AlertTriangle,
  Timer,
  CalendarDays,
  Search,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { hrApi, payrollApi, type PayrollTimesheetView, type WorkShiftView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

type WorkforceTab = 'attendance' | 'overtime' | 'leave';

const TABS: { key: WorkforceTab; label: string; icon: React.ElementType }[] = [
  { key: 'attendance', label: 'Attendance', icon: UserCheck },
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

function formatCurrency(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

export function WorkforceModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);

  const [activeTab, setActiveTab] = useState<WorkforceTab>('attendance');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

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

  const attendanceQuery = useListQueryState<{
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
  const overtimeQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'overtimeHours',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined },
  });
  const patchAttendanceFilters = attendanceQuery.patchFilters;
  const patchOvertimeFilters = overtimeQuery.patchFilters;

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
      });
      setWorkShifts(page.items || []);
      setAttendanceTotal(page.total || page.totalCount || 0);
      setAttendanceHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error) {
      console.error('Workforce attendance load failed:', error);
      toast.error(getErrorMessage(error, 'Unable to load attendance data from backend'));
      setWorkShifts([]);
      setAttendanceTotal(0);
      setAttendanceHasMore(false);
      setAttendanceError('Unable to load attendance data');
    } finally {
      setAttendanceLoading(false);
    }
  }, [attendanceQuery.query, dateFilter, outletId, token]);

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
    } catch (error) {
      console.error('Workforce overtime load failed:', error);
      toast.error(getErrorMessage(error, 'Unable to load overtime data from backend'));
      setTimesheets([]);
      setTimesheetsTotal(0);
      setTimesheetsHasMore(false);
      setOvertimeError('Unable to load overtime data');
    } finally {
      setOvertimeLoading(false);
    }
  }, [outletId, overtimeQuery.query, token]);

  useEffect(() => {
    patchAttendanceFilters({
      outletId: outletId || undefined,
      startDate: dateFilter,
      endDate: dateFilter,
    });
    patchOvertimeFilters({ outletId: outletId || undefined });
  }, [dateFilter, outletId, patchAttendanceFilters, patchOvertimeFilters]);

  useEffect(() => {
    if (activeTab !== 'attendance') return;
    void loadAttendance();
  }, [activeTab, loadAttendance]);

  useEffect(() => {
    if (activeTab !== 'overtime') return;
    void loadOvertime();
  }, [activeTab, loadOvertime]);

  const attendanceStats = useMemo(() => {
    const checkedIn = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'checked_in').length;
    const checkedOut = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'checked_out').length;
    const absent = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'absent').length;
    const onLeave = workShifts.filter((row) => String(row.attendanceStatus || '').toLowerCase() === 'leave').length;
    return { checkedIn, checkedOut, absent, onLeave };
  }, [workShifts]);

  const overtimeRows = useMemo(() => timesheets.filter((row) => toNumber(row.overtimeHours) > 0), [timesheets]);

  const overtimeStats = useMemo(() => {
    const totalOvertime = overtimeRows.reduce((sum, row) => sum + toNumber(row.overtimeHours), 0);
    const totalAbsentDays = overtimeRows.reduce((sum, row) => sum + toNumber(row.absentDays), 0);
    const avgOvertime = overtimeRows.length > 0 ? totalOvertime / overtimeRows.length : 0;
    return { totalOvertime, totalAbsentDays, avgOvertime };
  }, [overtimeRows]);

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Workforce" />;
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
              value={activeTab === 'attendance' ? attendanceQuery.searchInput : overtimeQuery.searchInput}
              onChange={(event) => {
                if (activeTab === 'attendance') {
                  attendanceQuery.setSearchInput(event.target.value);
                } else if (activeTab === 'overtime') {
                  overtimeQuery.setSearchInput(event.target.value);
                }
              }}
              placeholder="Search employee / shift / period"
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
          {activeTab === 'attendance' ? (
            <button
              onClick={() => void loadAttendance()}
              disabled={attendanceLoading}
              className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', attendanceLoading ? 'animate-spin' : '')} /> Refresh
            </button>
          ) : null}
          {activeTab === 'overtime' ? (
            <button
              onClick={() => void loadOvertime()}
              disabled={overtimeLoading}
              className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', overtimeLoading ? 'animate-spin' : '')} /> Refresh
            </button>
          ) : null}
        </div>

        {activeTab === 'attendance' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Checked In', value: attendanceStats.checkedIn, icon: UserCheck },
                { label: 'Checked Out', value: attendanceStats.checkedOut, icon: Clock },
                { label: 'Absent', value: attendanceStats.absent, icon: UserX },
                { label: 'On Leave', value: attendanceStats.onLeave, icon: CalendarDays },
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
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Work Shift', 'Date', 'User', 'Shift', 'Attendance', 'Approval', 'Clock In', 'Clock Out'].map((header) => (
                        <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLoading && workShifts.length === 0 ? (
                      <ListTableSkeleton columns={8} rows={6} />
                    ) : workShifts.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No attendance rows found</td></tr>
                    ) : workShifts.map((row) => (
                      <tr key={String(row.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(row.id)}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.workDate || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.userId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.shiftId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.attendanceStatus || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.approvalStatus || '—')}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.actualStartTime ? new Date(String(row.actualStartTime)).toLocaleTimeString() : '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.actualEndTime ? new Date(String(row.actualEndTime)).toLocaleTimeString() : '—'}</td>
                      </tr>
                    ))}
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

        {activeTab === 'overtime' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { label: 'Total Overtime Hours', value: overtimeStats.totalOvertime.toFixed(2), icon: Timer },
                { label: 'Average Overtime', value: overtimeStats.avgOvertime.toFixed(2), icon: TrendingUp },
                { label: 'Absent Days (Overtime Group)', value: overtimeStats.totalAbsentDays.toFixed(2), icon: AlertTriangle },
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
              {overtimeError ? <p className="text-xs text-destructive">{overtimeError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Timesheet', 'Period', 'User', 'Outlet', 'Work Hours', 'Overtime', 'Rate', 'Estimated OT Cost'].map((header) => (
                        <th key={header} className={cn('text-[11px] px-4 py-2.5', ['Work Hours', 'Overtime', 'Rate', 'Estimated OT Cost'].includes(header) ? 'text-right' : 'text-left')}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overtimeLoading && timesheets.length === 0 ? (
                      <ListTableSkeleton columns={8} rows={6} />
                    ) : overtimeRows.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No overtime rows found</td></tr>
                    ) : overtimeRows.map((row) => {
                      const overtimeHours = toNumber(row.overtimeHours);
                      const overtimeRate = toNumber(row.overtimeRate);
                      const estimatedOtCost = overtimeHours * overtimeRate;
                      return (
                        <tr key={String(row.id)} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-xs font-mono">{String(row.id)}</td>
                          <td className="px-4 py-2.5 text-xs">{String(row.payrollPeriodName || row.payrollPeriodId || '—')}</td>
                          <td className="px-4 py-2.5 text-xs">{String(row.userId || '—')}</td>
                          <td className="px-4 py-2.5 text-xs">{String(row.outletId || '—')}</td>
                          <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(row.workHours).toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-xs font-mono">{overtimeHours.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-xs font-mono">{overtimeRate.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">{formatCurrency(estimatedOtCost)}</td>
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
            </div>
          </div>
        ) : null}

        {activeTab === 'leave' ? (
          <EmptyState
            title="Leave APIs are not exposed"
            description="The current backend contract does not provide leave-request and leave-quota endpoints for this module."
          />
        ) : null}
      </div>
    </div>
  );
}
