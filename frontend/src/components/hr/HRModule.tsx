import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Clock,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  authApi,
  hrApi,
  orgApi,
  type AuthUsersQuery,
  type AuthUserListItem,
  type ShiftsQuery,
  type ContractView,
  type ScopeOutlet,
  type ScopeRegion,
  type ShiftView,
  type WorkShiftView,
} from '@/api/fern-api';
import { hasHrCompensationAccess } from '@/auth/authorization';
import { useAuth } from '@/auth/use-auth';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import {
  approvalBadgeClass,
  attendanceBadgeClass,
  contractBadgeClass,
  formatHrEnumLabel,
  getHrOutletDisplay,
  getHrShiftDisplay,
  getHrUserDisplay,
  shortHrRef,
} from '@/components/hr/hr-display';
import { PayrollPrepWorkspace } from '@/components/hr/PayrollPrepWorkspace';
import { collectPagedItems } from '@/lib/collect-paged-items';
import { HR_TAB_ITEMS, type HrTab } from '@/components/hr/hr-workspace-config';

const TAB_ICONS: Record<HrTab, React.ElementType> = {
  attendance: Clock,
  contracts: FileText,
  prep: FileText,
};

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
  const [createContractDialog, setCreateContractDialog] = useState(false);
  const [contractForm, setContractForm] = useState({
    userId: '',
    employmentType: 'indefinite',
    salaryType: 'monthly',
    baseSalary: '',
    currencyCode: 'USD',
    regionCode: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    taxCode: '',
    bankAccount: '',
  });
  const [terminateDialog, setTerminateDialog] = useState<{ contractId: string; endDate: string } | null>(null);
  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [regions, setRegions] = useState<ScopeRegion[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);
  const [shifts, setShifts] = useState<ShiftView[]>([]);

  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [workShifts, setWorkShifts] = useState<WorkShiftView[]>([]);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [attendanceHasMore, setAttendanceHasMore] = useState(false);

  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState('');
  const [contracts, setContracts] = useState<ContractView[]>([]);
  const [contractsTotal, setContractsTotal] = useState(0);
  const [contractsHasMore, setContractsHasMore] = useState(false);
  const [contractExpiryStats, setContractExpiryStats] = useState({ active: 0, expiring: 0, terminated: 0 });

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
  const contractsQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'startDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const patchAttendanceFilters = attendanceQuery.patchFilters;
  const patchContractsFilters = contractsQuery.patchFilters;
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const outletsById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const shiftsById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);
  const visibleTabs = useMemo(
    () => HR_TAB_ITEMS.filter((tab) => tab.key === 'attendance' || canAccessCompensation),
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

  const loadContracts = useCallback(async () => {
    if (!token) return;
    setContractsLoading(true);
    setContractsError('');

    // Compute 30-day expiry window for the dedicated stats query
    const expiryWindowEnd = new Date();
    expiryWindowEnd.setDate(expiryWindowEnd.getDate() + 30);
    const expiryWindowEndStr = expiryWindowEnd.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    try {
      const [page, activeCount, expiringCount, terminatedCount] = await Promise.all([
        hrApi.contractsPaged(token, {
          ...contractsQuery.query,
          outletId: outletId || undefined,
          status: contractsQuery.filters.status,
        }),
        // Active contracts (total count only, limit=1 for efficiency)
        hrApi.contractsPaged(token, { outletId: outletId || undefined, status: 'active', limit: 1, offset: 0 }),
        // Expiring: active contracts whose end date falls within the next 30 days
        hrApi.contractsPaged(token, {
          outletId: outletId || undefined,
          status: 'active',
          endDateFrom: todayStr,
          endDateTo: expiryWindowEndStr,
          limit: 1,
          offset: 0,
        }),
        // Terminated contracts
        hrApi.contractsPaged(token, { outletId: outletId || undefined, status: 'terminated', limit: 1, offset: 0 }),
      ]);
      setContracts(page.items || []);
      setContractsTotal(page.total || page.totalCount || 0);
      setContractsHasMore(page.hasMore || page.hasNextPage || false);
      setContractExpiryStats({
        active: activeCount.total || activeCount.totalCount || 0,
        expiring: expiringCount.total || expiringCount.totalCount || 0,
        terminated: terminatedCount.total || terminatedCount.totalCount || 0,
      });
    } catch (error: unknown) {
      console.error('HR contracts load failed', error);
      setContracts([]);
      setContractsTotal(0);
      setContractsHasMore(false);
      setContractsError(getErrorMessage(error, 'Unable to load contracts'));
    } finally {
      setContractsLoading(false);
    }
  }, [contractsQuery.filters.status, contractsQuery.query, outletId, token]);

  useEffect(() => {
    patchAttendanceFilters({
      outletId: outletId || undefined,
      startDate: startDateFilter,
      endDate: endDateFilter,
    });
    patchContractsFilters({ outletId: outletId || undefined });
  }, [startDateFilter, endDateFilter, outletId, patchAttendanceFilters, patchContractsFilters]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void Promise.allSettled([
      orgApi.hierarchy(token),
      collectPagedItems<AuthUserListItem, AuthUsersQuery>(
        (query) => authApi.users(token, query),
        {
          outletId: outletId || undefined,
          sortBy: 'username',
          sortDir: 'asc',
        },
        200,
      ),
      collectPagedItems<ShiftView, ShiftsQuery>(
        (query) => hrApi.shiftsPaged(token, query),
        {
          outletId: outletId || undefined,
          sortBy: 'startTime',
          sortDir: 'asc',
        },
      ),
    ]).then(([hierarchyResult, usersResult, shiftsResult]) => {
      if (!active) return;
      if (hierarchyResult.status === 'fulfilled') {
        setRegions(hierarchyResult.value.regions || []);
        setOutlets(hierarchyResult.value.outlets || []);
      }
      if (usersResult.status === 'fulfilled') {
        setUsers(usersResult.value || []);
      }
      if (shiftsResult.status === 'fulfilled') {
        setShifts(shiftsResult.value || []);
      }
    }).catch((error: unknown) => {
      console.error('HR support data load failed', error);
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
    if (activeTab !== 'contracts') return;
    void loadContracts();
  }, [activeTab, loadContracts]);

  useEffect(() => {
    if (activeTab === 'attendance' || canAccessCompensation) {
      return;
    }
    setActiveTab('attendance');
  }, [activeTab, canAccessCompensation]);

  // Contract stats come from dedicated API queries (not derived from the current page)
  // so counts are accurate across all pages, not just the visible slice.
  const contractStats = contractExpiryStats;

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

  const submitCreateContract = async () => {
    if (!token) return;
    const base = parseFloat(contractForm.baseSalary);
    if (!contractForm.userId.trim()) { toast.error('Select an employee'); return; }
    if (!contractForm.startDate) { toast.error('Start date is required'); return; }
    if (!base || base <= 0) { toast.error('Base salary must be a positive number'); return; }
    if (!contractForm.currencyCode.trim() || contractForm.currencyCode.trim().length !== 3) {
      toast.error('Enter a valid 3-letter currency code'); return;
    }
    setBusyKey('contract:create');
    try {
      await hrApi.createContract(token, {
        userId: contractForm.userId.trim(),
        employmentType: contractForm.employmentType,
        salaryType: contractForm.salaryType,
        baseSalary: base,
        currencyCode: contractForm.currencyCode.trim(),
        regionCode: contractForm.regionCode.trim() || null,
        startDate: contractForm.startDate,
        endDate: contractForm.endDate || null,
        taxCode: contractForm.taxCode.trim() || null,
        bankAccount: contractForm.bankAccount.trim() || null,
      });
      toast.success('Contract created');
      setCreateContractDialog(false);
      setContractForm({
        userId: '',
        employmentType: 'indefinite',
        salaryType: 'monthly',
        baseSalary: '',
        currencyCode: 'USD',
        regionCode: '',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: '',
        taxCode: '',
        bankAccount: '',
      });
      await loadContracts();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create contract'));
    } finally {
      setBusyKey('');
    }
  };

  const submitTerminateContract = async () => {
    if (!terminateDialog || !token) return;
    setBusyKey(`contract:terminate:${terminateDialog.contractId}`);
    try {
      await hrApi.terminateContract(token, terminateDialog.contractId, {
        endDate: terminateDialog.endDate || null,
      });
      toast.success('Contract terminated');
      setTerminateDialog(null);
      await loadContracts();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to terminate contract'));
    } finally {
      setBusyKey('');
    }
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
            <div className="surface-elevated p-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">From</span>
                <input
                  type="date"
                  value={startDateFilter}
                  max={endDateFilter}
                  onChange={(event) => setStartDateFilter(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                />
                <span className="text-xs text-muted-foreground">To</span>
                <input
                  type="date"
                  value={endDateFilter}
                  min={startDateFilter}
                  onChange={(event) => setEndDateFilter(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                />
                <button
                  onClick={() => { setStartDateFilter(today); setEndDateFilter(today); }}
                  className="h-8 px-2 rounded border text-[10px] text-muted-foreground hover:bg-accent"
                  title="Reset to today"
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    const d = new Date();
                    const day = d.getDay();
                    const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
                    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
                    setStartDateFilter(mon.toISOString().slice(0, 10));
                    setEndDateFilter(sun.toISOString().slice(0, 10));
                  }}
                  className="h-8 px-2 rounded border text-[10px] text-muted-foreground hover:bg-accent"
                  title="This week"
                >
                  This week
                </button>
              </div>
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={attendanceQuery.searchInput}
                  onChange={(event) => attendanceQuery.setSearchInput(event.target.value)}
                  placeholder="Search employee, shift, note"
                  className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
                />
              </div>
              <select
                value={attendanceQuery.filters.attendanceStatus || 'all'}
                onChange={(event) => attendanceQuery.setFilter('attendanceStatus', event.target.value === 'all' ? undefined : event.target.value)}
                className="h-8 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="all">All attendance</option>
                <option value="pending">Pending</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="leave">Leave</option>
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
                <option value="createdAt:desc">Last updated</option>
              </select>
              <button
                onClick={() => void loadAttendance()}
                disabled={attendanceLoading}
                className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', attendanceLoading ? 'animate-spin' : '')} /> Refresh
              </button>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              {attendanceError ? <p className="text-xs text-destructive">{attendanceError}</p> : null}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Attendance Review ({attendanceTotal})</h3>
                  <p className="text-xs text-muted-foreground">Review shift records by attendance outcome and approval state for the selected date range.</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Shift Record', 'Employee', 'Shift', 'Attendance', 'Review', 'Clock', 'Note', 'Actions'].map((header) => (
                        <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLoading && workShifts.length === 0 ? (
                      <ListTableSkeleton columns={8} rows={6} />
                    ) : workShifts.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No attendance records found</td></tr>
                    ) : workShifts.map((row) => {
                      const attendanceStatus = String(row.attendanceStatus || 'unknown').toLowerCase();
                      const approvalStatus = String(row.approvalStatus || 'unknown').toLowerCase();
                      const workShiftId = String(row.id);
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
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', attendanceBadgeClass(attendanceStatus))}>
                              {formatHrEnumLabel(attendanceStatus)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', approvalBadgeClass(approvalStatus))}>
                              {formatHrEnumLabel(approvalStatus)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <div className="flex flex-col">
                              <span>In {formatTime(row.actualStartTime)}</span>
                              <span>Out {formatTime(row.actualEndTime)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(row.note || '—')}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => void approveAttendance(workShiftId)}
                                disabled={!canReview || busyKey === `attendance:approve:${workShiftId}`}
                                className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                              >
                                {busyKey === `attendance:approve:${workShiftId}` ? 'Approving...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => openRejectDialog(workShiftId)}
                                disabled={!canReview || busyKey === `attendance:reject:${workShiftId}`}
                                className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                              >
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
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: 'Active Contracts', value: contractStats.active, icon: CheckCircle2 },
                { label: 'Expiring Soon', value: contractStats.expiring, icon: AlertTriangle },
                { label: 'Terminated', value: contractStats.terminated, icon: FileText },
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
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Contracts ({contractsTotal})</h3>
                  <p className="text-xs text-muted-foreground">Track employment terms, salary basis, and expiry risk from the active contract register.</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search contracts"
                      value={contractsQuery.searchInput}
                      onChange={(event) => contractsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={contractsQuery.filters.status || 'all'}
                    onChange={(event) => contractsQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                    <option value="terminated">Terminated</option>
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${contractsQuery.sortBy || 'startDate'}:${contractsQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      contractsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="startDate:desc">Latest start date</option>
                    <option value="endDate:asc">Ending soon</option>
                    <option value="status:asc">Status A-Z</option>
                    <option value="createdAt:desc">Last created</option>
                  </select>
                  <button
                    onClick={() => void loadContracts()}
                    disabled={contractsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', contractsLoading ? 'animate-spin' : '')} /> Refresh
                  </button>
                  <button
                    onClick={() => setCreateContractDialog(true)}
                    className="h-8 px-3 rounded bg-primary text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    + New Contract
                  </button>
                </div>
              </div>

              {contractsError ? <p className="text-xs text-destructive">{contractsError}</p> : null}

              {contracts.length === 0 && !contractsLoading ? (
                <EmptyState
                  title="No contracts available"
                  description="No contract rows were returned for the current scope and filters."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {['Contract', 'User', 'Employment Type', 'Salary Type', 'Base Salary', 'Start Date', 'End Date', 'Status', 'Actions'].map((header) => (
                          <th key={header} className={cn('text-[11px] px-4 py-2.5', header === 'Base Salary' ? 'text-right' : 'text-left')}>
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contractsLoading && contracts.length === 0 ? (
                        <ListTableSkeleton columns={8} rows={6} />
                      ) : contracts.map((contract) => {
                        const status = String(contract.status || 'unknown').toLowerCase();
                        const userDisplay = getHrUserDisplay(usersById, contract.userId);
                        return (
                          <tr key={String(contract.id)} className="border-b last:border-0">
                            <td className="px-4 py-2.5">
                              <div className="flex flex-col">
                                <span className="text-xs font-medium">{shortHrRef(contract.id)}</span>
                                <span className="text-[11px] text-muted-foreground">{String(contract.regionCode || '—')}</span>
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
                            <td className="px-4 py-2.5 text-xs">{formatHrEnumLabel(contract.employmentType)}</td>
                            <td className="px-4 py-2.5 text-xs">{formatHrEnumLabel(contract.salaryType)}</td>
                            <td className="px-4 py-2.5 text-right text-sm font-mono">{formatCurrency(contract.baseSalary, String(contract.currencyCode || 'USD'))}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(contract.startDate)}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(contract.endDate)}</td>
                            <td className="px-4 py-2.5 text-xs">
                              <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', contractBadgeClass(status))}>
                                {formatHrEnumLabel(status)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              {status === 'active' || status === 'draft' ? (
                                <button
                                  onClick={() => setTerminateDialog({ contractId: String(contract.id), endDate: new Date().toISOString().slice(0, 10) })}
                                  disabled={busyKey === `contract:terminate:${contract.id}`}
                                  className="h-7 px-2.5 rounded border border-destructive/50 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                >
                                  Terminate
                                </button>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <ListPaginationControls
                total={contractsTotal}
                limit={contractsQuery.limit}
                offset={contractsQuery.offset}
                hasMore={contractsHasMore}
                disabled={contractsLoading}
                onPageChange={contractsQuery.setPage}
                onLimitChange={contractsQuery.setPageSize}
              />
            </div>
          </div>
        ) : null}

        {(attendanceLoading || contractsLoading) ? (
          <div className="hidden">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}
      </div>
    </div>

    {createContractDialog ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h3 className="text-base font-semibold">New Employee Contract</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Create an employment contract for an employee.</p>
            </div>
            <button type="button" onClick={() => setCreateContractDialog(false)} className="rounded p-1 hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Employee ID <span className="text-destructive">*</span></label>
              <select
                value={contractForm.userId}
                onChange={(e) => setContractForm((prev) => ({ ...prev, userId: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— Select employee —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName || u.username} {u.employeeCode ? `(${u.employeeCode})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Employment Type</label>
                <select
                  value={contractForm.employmentType}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, employmentType: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="indefinite">Indefinite</option>
                  <option value="fixed_term">Fixed Term</option>
                  <option value="probation">Probation</option>
                  <option value="seasonal">Seasonal</option>
                  <option value="part_time">Part Time</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Salary Type</label>
                <select
                  value={contractForm.salaryType}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, salaryType: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="monthly">Monthly</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Base Salary <span className="text-destructive">*</span></label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={contractForm.baseSalary}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, baseSalary: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="e.g. 5000"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Currency <span className="text-destructive">*</span></label>
                <input
                  type="text"
                  maxLength={3}
                  value={contractForm.currencyCode}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, currencyCode: e.target.value.toUpperCase() }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
                  placeholder="USD"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Start Date <span className="text-destructive">*</span></label>
                <input
                  type="date"
                  value={contractForm.startDate}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">End Date <span className="text-muted-foreground text-[10px]">(leave blank for indefinite)</span></label>
                <input
                  type="date"
                  value={contractForm.endDate}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Region Code</label>
                <input
                  type="text"
                  value={contractForm.regionCode}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, regionCode: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="e.g. VN"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Tax Code</label>
                <input
                  type="text"
                  value={contractForm.taxCode}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, taxCode: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Employee tax ID"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Bank Account</label>
              <input
                type="text"
                value={contractForm.bankAccount}
                onChange={(e) => setContractForm((prev) => ({ ...prev, bankAccount: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder="Account number for salary payment"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-4">
            <button type="button" onClick={() => setCreateContractDialog(false)} className="h-9 rounded-md border border-border px-4 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitCreateContract()}
              disabled={busyKey === 'contract:create'}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busyKey === 'contract:create' ? 'Creating...' : 'Create contract'}
            </button>
          </div>
        </div>
      </div>
    ) : null}

    {terminateDialog ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">Terminate Contract</h3>
            <button type="button" onClick={() => setTerminateDialog(null)} className="rounded p-1 hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-5 space-y-4">
            <p className="text-sm text-muted-foreground">This action will mark the contract as terminated. The employee will lose access linked to this contract.</p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Effective end date</label>
              <input
                type="date"
                value={terminateDialog.endDate}
                onChange={(e) => setTerminateDialog((prev) => prev ? { ...prev, endDate: e.target.value } : prev)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">Leave as today if terminating immediately.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-4">
            <button type="button" onClick={() => setTerminateDialog(null)} className="h-9 rounded-md border border-border px-4 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitTerminateContract()}
              disabled={!!busyKey}
              className="h-9 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {busyKey ? 'Terminating...' : 'Confirm terminate'}
            </button>
          </div>
        </div>
      </div>
    ) : null}

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
