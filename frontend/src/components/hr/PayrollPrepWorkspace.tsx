import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  FileText,
  Plus,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  authApi,
  hrApi,
  payrollApi,
  type AuthScopesQuery,
  type AuthScopeView,
  type AuthUserListItem,
  type ContractView,
  type PayrollPeriodView,
  type PayrollPeriodsQuery,
  type PayrollRunView,
  type PayrollRunsQuery,
  type PayrollTimesheetView,
  type PayrollTimesheetsQuery,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { EmptyState } from '@/components/shell/PermissionStates';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  contractBadgeClass,
  formatHrEnumLabel,
  getHrOutletDisplay,
  getHrUserDisplay,
  payrollBadgeClass,
  shortHrRef,
} from '@/components/hr/hr-display';
import { collectPagedItems } from '@/lib/collect-paged-items';
import {
  buildContractDrivenPayrollRoster,
  collectRegionScopeIds,
  inferPeriodWindowState,
  periodWindowBadgeClass,
  periodWindowLabel,
} from '@/components/payroll/payroll-truth';
import { cn } from '@/lib/utils';

interface PayrollPrepWorkspaceProps {
  token: string;
  users: AuthUserListItem[];
  outlets: ScopeOutlet[];
  regions: ScopeRegion[];
  scopeRegionId?: string;
  scopeOutletId?: string;
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

function formatDate(value?: string | null) {
  if (!value) {
    return '—';
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatDateRange(startDate?: string | null, endDate?: string | null) {
  if (!startDate && !endDate) {
    return 'Window unavailable';
  }
  return `${formatDate(startDate)} → ${formatDate(endDate)}`;
}

function formatMonthYear(value?: string | null) {
  if (!value) {
    return 'Payroll prep';
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return 'Payroll prep';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeValue(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

function getRegionName(regionsById: Map<string, ScopeRegion>, regionId?: string | number | null) {
  const key = normalizeValue(regionId);
  if (!key) {
    return 'Selected region';
  }
  return regionsById.get(key)?.name || `Region ${key}`;
}

function buildPeriodHeadline(period: PayrollPeriodView | null, regionName: string) {
  const explicitName = normalizeValue(period?.name);
  if (explicitName) {
    return explicitName;
  }
  return `${formatMonthYear(period?.startDate || period?.endDate || period?.payDate)} · ${regionName}`;
}

function buildDefaultPeriodForm(regionId = '') {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const payDate = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  return {
    regionId,
    name: '',
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
    payDate: formatDateInput(payDate),
    note: '',
  };
}

function buildDefaultTimesheetForm(outletId = '') {
  return {
    userId: '',
    outletId,
    workDays: '',
    workHours: '',
    overtimeHours: '0',
    overtimeRate: '1.5',
    lateCount: '0',
    absentDays: '0',
  };
}

function buildDefaultRunForm() {
  return {
    payrollTimesheetId: '',
    currencyCode: 'USD',
    baseSalaryAmount: '',
    netSalary: '',
    note: '',
  };
}

export function PayrollPrepWorkspace({
  token,
  users,
  outlets,
  regions,
  scopeRegionId,
  scopeOutletId,
}: PayrollPrepWorkspaceProps) {
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [authScopes, setAuthScopes] = useState<AuthScopeView[]>([]);
  const [contracts, setContracts] = useState<ContractView[]>([]);

  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState('');
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);

  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);
  const [periodForm, setPeriodForm] = useState(buildDefaultPeriodForm(scopeRegionId || ''));
  const [timesheetForm, setTimesheetForm] = useState(buildDefaultTimesheetForm(scopeOutletId || ''));
  const [runForm, setRunForm] = useState(buildDefaultRunForm());
  const [busyKey, setBusyKey] = useState('');

  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );
  const regionsById = useMemo(
    () => new Map(regions.map((region) => [region.id, region])),
    [regions],
  );
  const outletsById = useMemo(
    () => new Map(outlets.map((outlet) => [outlet.id, outlet])),
    [outlets],
  );

  const inferredRegionId = useMemo(() => {
    if (scopeRegionId) {
      return scopeRegionId;
    }
    if (!scopeOutletId) {
      return '';
    }
    return outlets.find((outlet) => outlet.id === scopeOutletId)?.regionId || '';
  }, [outlets, scopeOutletId, scopeRegionId]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const selectedRegionId = useMemo(
    () =>
      normalizeValue(
        selectedPeriod?.regionId ||
          periodForm.regionId ||
          inferredRegionId,
      ),
    [inferredRegionId, periodForm.regionId, selectedPeriod?.regionId],
  );

  const selectedRegionScopeIds = useMemo(
    () => collectRegionScopeIds(regions, selectedRegionId),
    [regions, selectedRegionId],
  );

  const selectedRegionCodes = useMemo(
    () =>
      selectedRegionScopeIds
        .map((regionId) => regionsById.get(regionId)?.code)
        .filter((code): code is string => Boolean(code)),
    [regionsById, selectedRegionScopeIds],
  );

  const availablePeriodRegions = useMemo(() => {
    if (!inferredRegionId) {
      return regions;
    }
    const allowedRegionIds = new Set(collectRegionScopeIds(regions, inferredRegionId));
    return regions.filter((region) => allowedRegionIds.has(region.id));
  }, [inferredRegionId, regions]);

  const selectedRegionName = useMemo(
    () => getRegionName(regionsById, selectedPeriod?.regionId || selectedRegionId),
    [regionsById, selectedPeriod?.regionId, selectedRegionId],
  );

  const selectedRegionOutlets = useMemo(() => {
    if (selectedRegionScopeIds.length === 0) {
      return outlets;
    }
    const allowed = new Set(selectedRegionScopeIds);
    return outlets.filter((outlet) => allowed.has(outlet.regionId));
  }, [outlets, selectedRegionScopeIds]);

  const payrollRoster = useMemo(
    () =>
      buildContractDrivenPayrollRoster({
        users,
        scopes: authScopes,
        contracts,
        outletsById,
        selectedRegionCodes,
      }),
    [authScopes, contracts, outletsById, selectedRegionCodes, users],
  );

  const contractsByUserId = useMemo(
    () => new Map(payrollRoster.map((entry) => [entry.userId, entry.contract])),
    [payrollRoster],
  );

  const selectedEmployee = useMemo(
    () => payrollRoster.find((entry) => entry.userId === timesheetForm.userId),
    [payrollRoster, timesheetForm.userId],
  );

  const runsByTimesheetId = useMemo(
    () =>
      new Map(
        runs
          .filter((run) => normalizeValue(run.payrollTimesheetId))
          .map((run) => [String(run.payrollTimesheetId), run]),
      ),
    [runs],
  );

  const availableRunTimesheets = useMemo(
    () =>
      timesheets
        .filter((timesheet) => !runsByTimesheetId.has(String(timesheet.id)))
        .sort((left, right) => normalizeValue(left.userId).localeCompare(normalizeValue(right.userId))),
    [runsByTimesheetId, timesheets],
  );

  const selectedRunSource = useMemo(
    () => timesheets.find((timesheet) => timesheet.id === runForm.payrollTimesheetId) ?? null,
    [runForm.payrollTimesheetId, timesheets],
  );

  const selectedRunContract = useMemo(
    () => (selectedRunSource?.userId ? contractsByUserId.get(String(selectedRunSource.userId)) : undefined),
    [contractsByUserId, selectedRunSource?.userId],
  );

  const timesheetRows = useMemo(
    () =>
      timesheets
        .map((timesheet) => ({
          timesheet,
          run: runsByTimesheetId.get(String(timesheet.id)),
        }))
        .sort((left, right) => normalizeValue(left.timesheet.userId).localeCompare(normalizeValue(right.timesheet.userId))),
    [runsByTimesheetId, timesheets],
  );

  const summary = useMemo(() => {
    const draftRuns = runs.filter((run) => normalizeValue(run.status).toLowerCase() === 'draft').length;
    const approvedRuns = runs.filter((run) => normalizeValue(run.status).toLowerCase() === 'approved').length;
    return {
      rosterCount: payrollRoster.length,
      timesheetCount: timesheets.length,
      draftRuns,
      approvedRuns,
    };
  }, [payrollRoster.length, runs, timesheets.length]);

  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const [scopeItems, activeContracts] = await Promise.all([
        collectPagedItems<AuthScopeView, AuthScopesQuery>(
          (query) => authApi.scopes(token, query),
          {
            status: 'active',
            sortBy: 'username',
            sortDir: 'asc',
          },
          200,
        ),
        hrApi.contractsActive(token),
      ]);
      setAuthScopes(scopeItems);
      setContracts(activeContracts || []);
    } catch (error: unknown) {
      console.error('Payroll prep directory load failed', error);
      setDirectoryError(getErrorMessage(error, 'Unable to load payroll prep roster'));
    } finally {
      setDirectoryLoading(false);
    }
  }, [token]);

  const loadPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    setPeriodsError('');
    try {
      const items = await collectPagedItems<PayrollPeriodView, PayrollPeriodsQuery>(
        (query) => payrollApi.periods(token, query),
        {
          regionId: inferredRegionId || undefined,
          sortBy: 'startDate',
          sortDir: 'desc',
        },
      );
      setPeriods(items);
      setSelectedPeriodId((current) => {
        if (current && items.some((period) => period.id === current)) {
          return current;
        }
        return items[0]?.id || '';
      });
    } catch (error: unknown) {
      console.error('Payroll prep period load failed', error);
      setPeriods([]);
      setSelectedPeriodId('');
      setPeriodsError(getErrorMessage(error, 'Unable to load payroll periods'));
    } finally {
      setPeriodsLoading(false);
    }
  }, [inferredRegionId, token]);

  const loadWorkspace = useCallback(async () => {
    if (!selectedPeriodId) {
      setTimesheets([]);
      setRuns([]);
      setWorkspaceError('');
      return;
    }
    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const [timesheetItems, runItems] = await Promise.all([
        collectPagedItems<PayrollTimesheetView, PayrollTimesheetsQuery>(
          (query) => payrollApi.timesheets(token, query),
          {
            payrollPeriodId: selectedPeriodId,
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
        ),
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (query) => payrollApi.runs(token, query),
          {
            payrollPeriodId: selectedPeriodId,
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
        ),
      ]);
      setTimesheets(timesheetItems);
      setRuns(runItems);
    } catch (error: unknown) {
      console.error('Payroll prep workspace load failed', error);
      setTimesheets([]);
      setRuns([]);
      setWorkspaceError(getErrorMessage(error, 'Unable to load payroll prep workspace'));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [scopeOutletId, selectedPeriodId, token]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (timesheetForm.userId && payrollRoster.some((entry) => entry.userId === timesheetForm.userId)) {
      return;
    }
    setTimesheetForm((current) => ({
      ...current,
      userId: '',
    }));
  }, [payrollRoster, timesheetForm.userId]);

  useEffect(() => {
    const defaultOutletId =
      (scopeOutletId && selectedRegionOutlets.some((outlet) => outlet.id === scopeOutletId) ? scopeOutletId : '') ||
      (selectedEmployee?.preferredOutletId && selectedRegionOutlets.some((outlet) => outlet.id === selectedEmployee.preferredOutletId)
        ? selectedEmployee.preferredOutletId
        : '') ||
      '';
    setTimesheetForm((current) => {
      if (current.outletId && selectedRegionOutlets.some((outlet) => outlet.id === current.outletId)) {
        return current;
      }
      return {
        ...current,
        outletId: defaultOutletId,
      };
    });
  }, [scopeOutletId, selectedEmployee?.preferredOutletId, selectedRegionOutlets]);

  useEffect(() => {
    setRunForm((current) => {
      if (
        current.payrollTimesheetId &&
        availableRunTimesheets.some((timesheet) => timesheet.id === current.payrollTimesheetId)
      ) {
        return current;
      }
      return {
        ...current,
        payrollTimesheetId: String(availableRunTimesheets[0]?.id || ''),
      };
    });
  }, [availableRunTimesheets]);

  useEffect(() => {
    setRunForm((current) => {
      if (!selectedRunSource?.userId) {
        return current;
      }
      const nextCurrency = String(selectedRunContract?.currencyCode || current.currencyCode || 'USD').toUpperCase();
      const nextBaseSalary = selectedRunContract?.baseSalary != null ? String(selectedRunContract.baseSalary) : current.baseSalaryAmount;
      if (current.currencyCode === nextCurrency && current.baseSalaryAmount === nextBaseSalary) {
        return current;
      }
      return {
        ...current,
        currencyCode: nextCurrency,
        baseSalaryAmount: nextBaseSalary,
      };
    });
  }, [selectedRunContract?.baseSalary, selectedRunContract?.currencyCode, selectedRunSource?.userId]);

  const createPeriod = async () => {
    if (!periodForm.regionId || !periodForm.startDate || !periodForm.endDate) {
      toast.error('Region and payroll window are required');
      return;
    }
    if (periodForm.endDate < periodForm.startDate) {
      toast.error('End date must be on or after start date');
      return;
    }
    if (periodForm.payDate && periodForm.payDate < periodForm.endDate) {
      toast.error('Pay date must be on or after the end date');
      return;
    }

    setBusyKey('create-period');
    try {
      await payrollApi.createPeriod(token, {
        regionId: periodForm.regionId,
        name: periodForm.name.trim() || `${formatMonthYear(periodForm.startDate)} ${getRegionName(regionsById, periodForm.regionId)} payroll`,
        startDate: periodForm.startDate,
        endDate: periodForm.endDate,
        payDate: periodForm.payDate || null,
        note: periodForm.note.trim() || null,
      });
      toast.success('Payroll period created');
      setPeriodDialogOpen(false);
      setPeriodForm(buildDefaultPeriodForm(periodForm.regionId));
      await loadPeriods();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create payroll period'));
    } finally {
      setBusyKey('');
    }
  };

  const createTimesheet = async () => {
    if (!selectedPeriod) {
      toast.error('Choose a payroll period first');
      return;
    }
    if (!timesheetForm.userId) {
      toast.error('Select an employee from the active contract roster');
      return;
    }
    if (!timesheetForm.outletId) {
      toast.error('Select an outlet before creating the timesheet');
      return;
    }

    setBusyKey('create-timesheet');
    try {
      await payrollApi.createTimesheet(token, {
        payrollPeriodId: String(selectedPeriod.id),
        userId: timesheetForm.userId,
        outletId: timesheetForm.outletId,
        workDays: toNumber(timesheetForm.workDays),
        workHours: toNumber(timesheetForm.workHours),
        overtimeHours: toNumber(timesheetForm.overtimeHours),
        overtimeRate: toNumber(timesheetForm.overtimeRate),
        lateCount: Math.max(0, Math.trunc(toNumber(timesheetForm.lateCount))),
        absentDays: toNumber(timesheetForm.absentDays),
      });
      toast.success('Timesheet logged');
      setTimesheetForm(buildDefaultTimesheetForm(timesheetForm.outletId));
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create timesheet'));
    } finally {
      setBusyKey('');
    }
  };

  const importFromAttendance = async () => {
    if (!selectedPeriod) {
      toast.error('Choose a payroll period first');
      return;
    }
    if (!timesheetForm.userId) {
      toast.error('Select an employee from the active contract roster');
      return;
    }
    if (!timesheetForm.outletId) {
      toast.error('Select an outlet before importing attendance');
      return;
    }

    setBusyKey('import-timesheet');
    try {
      await payrollApi.importFromAttendance(token, {
        payrollPeriodId: String(selectedPeriod.id),
        userId: timesheetForm.userId,
        outletId: timesheetForm.outletId,
        overtimeRate: toNumber(timesheetForm.overtimeRate) || 1.5,
      });
      toast.success('Timesheet imported from attendance');
      setTimesheetForm(buildDefaultTimesheetForm(timesheetForm.outletId));
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to import attendance'));
    } finally {
      setBusyKey('');
    }
  };

  const generateRun = async () => {
    if (!runForm.payrollTimesheetId) {
      toast.error('Select a timesheet first');
      return;
    }
    if (toNumber(runForm.baseSalaryAmount) <= 0) {
      toast.error('Base salary must be greater than zero');
      return;
    }
    if (toNumber(runForm.netSalary) <= 0) {
      toast.error('Net salary is still a manual input in phase 1');
      return;
    }

    setBusyKey('generate-run');
    try {
      await payrollApi.generateRun(token, {
        payrollTimesheetId: runForm.payrollTimesheetId,
        currencyCode: runForm.currencyCode,
        baseSalaryAmount: toNumber(runForm.baseSalaryAmount),
        netSalary: toNumber(runForm.netSalary),
        note: runForm.note.trim() || null,
      });
      toast.success('Draft payroll run generated');
      setRunForm(buildDefaultRunForm());
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to generate payroll run'));
    } finally {
      setBusyKey('');
    }
  };

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="surface-elevated overflow-hidden">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              <span>Payroll windows</span>
            </div>
            <h3 className="mt-2 text-lg font-semibold">Payroll prep</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Build labor input from active contracts, then create draft payroll runs for Finance to review.
            </p>
          </div>

          {periodsError ? <p className="border-b px-5 py-3 text-xs text-destructive">{periodsError}</p> : null}

          <div className="flex items-center gap-2 border-b px-5 py-3">
            <button
              onClick={() => setPeriodDialogOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New period
            </button>
            <button
              onClick={() => {
                void loadDirectory();
                void loadPeriods();
                void loadWorkspace();
              }}
              disabled={directoryLoading || periodsLoading || workspaceLoading}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', directoryLoading || periodsLoading || workspaceLoading ? 'animate-spin' : '')} />
              Refresh
            </button>
          </div>

          {periodsLoading && periods.length === 0 ? (
            <div className="px-5 py-10 text-sm text-muted-foreground">Loading payroll windows…</div>
          ) : periods.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title="No payroll windows in scope"
                description="Create a payroll period before importing attendance or generating draft payroll runs."
              />
            </div>
          ) : (
            <div className="max-h-[calc(100vh-20rem)] overflow-y-auto">
              {periods.map((period) => {
                const state = inferPeriodWindowState(period);
                const selected = period.id === selectedPeriodId;
                return (
                  <button
                    key={period.id}
                    type="button"
                    onClick={() => setSelectedPeriodId(period.id)}
                    className={cn(
                      'w-full border-b px-5 py-4 text-left transition-colors hover:bg-accent/30',
                      selected ? 'bg-accent/40' : 'bg-background',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {buildPeriodHeadline(period, getRegionName(regionsById, period.regionId))}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateRange(period.startDate, period.endDate)}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">Pay date {formatDate(period.payDate)}</p>
                      </div>
                      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', periodWindowBadgeClass(state))}>
                        {periodWindowLabel(state)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="space-y-5">
          {selectedPeriod ? (
            <>
              <div className="surface-elevated overflow-hidden">
                <div className="border-b px-5 py-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Preparation desk</span>
                      </div>
                      <h3 className="mt-2 text-2xl font-semibold tracking-tight">
                        {buildPeriodHeadline(selectedPeriod, selectedRegionName)}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        This is the only workspace that prepares payroll in phase 1. Finance approves later; salary values remain manual inputs until backend calculation moves server-side.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium', periodWindowBadgeClass(inferPeriodWindowState(selectedPeriod)))}>
                          {periodWindowLabel(inferPeriodWindowState(selectedPeriod))}
                        </span>
                        <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                          {selectedRegionName}
                        </span>
                        <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                          {formatDateRange(selectedPeriod.startDate, selectedPeriod.endDate)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                      <span>{summary.rosterCount} rostered</span>
                      <span>·</span>
                      <span>{summary.timesheetCount} timesheets</span>
                      <span>·</span>
                      <span>{summary.draftRuns} draft runs</span>
                      <span>·</span>
                      <span>{summary.approvedRuns} approved</span>
                    </div>
                  </div>
                </div>

                {directoryError ? <p className="border-b px-5 py-3 text-xs text-destructive">{directoryError}</p> : null}
                {workspaceError ? <p className="border-b px-5 py-3 text-xs text-destructive">{workspaceError}</p> : null}

                <div className="grid gap-5 px-5 py-5 xl:grid-cols-2">
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span>Timesheet capture</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <label className="text-xs text-muted-foreground">Employee from active contracts</label>
                        <select
                          value={timesheetForm.userId}
                          onChange={(event) => setTimesheetForm((current) => ({ ...current, userId: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Select employee</option>
                          {payrollRoster.map((entry) => (
                            <option key={entry.userId} value={entry.userId}>
                              {entry.fullName}{entry.employeeCode ? ` · ${entry.employeeCode}` : ''}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Only employees with an active HR contract in scope appear here.
                        </p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="text-xs text-muted-foreground">Outlet</label>
                        <select
                          value={timesheetForm.outletId}
                          onChange={(event) => setTimesheetForm((current) => ({ ...current, outletId: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Select outlet</option>
                          {selectedRegionOutlets.map((outlet) => (
                            <option key={outlet.id} value={outlet.id}>
                              {outlet.code} · {outlet.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Outlet is required in phase 1 so approved payroll can materialize into the finance ledger.
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground">Work days</label>
                        <input
                          type="number"
                          value={timesheetForm.workDays}
                          onChange={(event) => setTimesheetForm((current) => ({ ...current, workDays: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Work hours</label>
                        <input
                          type="number"
                          value={timesheetForm.workHours}
                          onChange={(event) => setTimesheetForm((current) => ({ ...current, workHours: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Overtime hours</label>
                        <input
                          type="number"
                          value={timesheetForm.overtimeHours}
                          onChange={(event) => setTimesheetForm((current) => ({ ...current, overtimeHours: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Overtime rate</label>
                        <input
                          type="number"
                          value={timesheetForm.overtimeRate}
                          onChange={(event) => setTimesheetForm((current) => ({ ...current, overtimeRate: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Late count</label>
                        <input
                          type="number"
                          value={timesheetForm.lateCount}
                          onChange={(event) => setTimesheetForm((current) => ({ ...current, lateCount: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Absent days</label>
                        <input
                          type="number"
                          value={timesheetForm.absentDays}
                          onChange={(event) => setTimesheetForm((current) => ({ ...current, absentDays: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                    </div>

                    {selectedEmployee ? (
                      <div className="rounded-xl border border-border bg-background/70 px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{selectedEmployee.fullName}</span>
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', contractBadgeClass(selectedEmployee.contract.status))}>
                            {formatHrEnumLabel(selectedEmployee.contract.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedEmployee.employeeCode || selectedEmployee.contract.employmentType || 'Contract roster'}
                          {selectedEmployee.outletLabels.length > 0 ? ` · ${selectedEmployee.outletLabels.join(', ')}` : ''}
                        </p>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void importFromAttendance()}
                        disabled={busyKey === 'import-timesheet' || !selectedPeriod}
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                      >
                        <Clock className="h-4 w-4" />
                        {busyKey === 'import-timesheet' ? 'Importing…' : 'Import attendance'}
                      </button>
                      <button
                        onClick={() => void createTimesheet()}
                        disabled={busyKey === 'create-timesheet' || !selectedPeriod}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                      >
                        <FileText className="h-4 w-4" />
                        {busyKey === 'create-timesheet' ? 'Saving…' : 'Log manual timesheet'}
                      </button>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Draft run generator</span>
                    </div>
                    <div className="grid gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Timesheet without run</label>
                        <select
                          value={runForm.payrollTimesheetId}
                          onChange={(event) => setRunForm((current) => ({ ...current, payrollTimesheetId: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Select timesheet</option>
                          {availableRunTimesheets.map((timesheet) => {
                            const userDisplay = getHrUserDisplay(usersById, timesheet.userId);
                            return (
                              <option key={timesheet.id} value={timesheet.id}>
                                {userDisplay.primary} · {toNumber(timesheet.workHours).toFixed(2)} hrs
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {selectedRunSource ? (
                        <div className="rounded-xl border border-border bg-background/70 px-4 py-3 text-sm">
                          <p className="font-medium">{getHrUserDisplay(usersById, selectedRunSource.userId).primary}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {getHrOutletDisplay(outletsById, selectedRunSource.outletId).primary}
                            {' · '}
                            {toNumber(selectedRunSource.workHours).toFixed(2)} hrs
                            {' · '}
                            {toNumber(selectedRunSource.overtimeHours).toFixed(2)} OT
                          </p>
                        </div>
                      ) : null}

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="text-xs text-muted-foreground">Currency</label>
                          <input
                            value={runForm.currencyCode}
                            onChange={(event) => setRunForm((current) => ({ ...current, currencyCode: event.target.value.toUpperCase() }))}
                            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Base salary</label>
                          <input
                            type="number"
                            value={runForm.baseSalaryAmount}
                            onChange={(event) => setRunForm((current) => ({ ...current, baseSalaryAmount: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-xs text-muted-foreground">Net salary</label>
                          <input
                            type="number"
                            value={runForm.netSalary}
                            onChange={(event) => setRunForm((current) => ({ ...current, netSalary: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-xs text-muted-foreground">Run note</label>
                          <textarea
                            value={runForm.note}
                            onChange={(event) => setRunForm((current) => ({ ...current, note: event.target.value }))}
                            className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="Optional note for Finance"
                          />
                        </div>
                      </div>

                      <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs text-blue-900">
                        Base salary is prefilled from the active contract when available. Net salary is still a manual input in phase 1 because backend payroll calculation has not moved server-side yet.
                      </div>

                      <div>
                        <button
                          onClick={() => void generateRun()}
                          disabled={busyKey === 'generate-run' || !selectedPeriod}
                          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                        >
                          <Sparkles className="h-4 w-4" />
                          {busyKey === 'generate-run' ? 'Generating…' : 'Generate draft run'}
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="surface-elevated overflow-hidden">
                  <div className="border-b px-5 py-4">
                    <h4 className="text-sm font-semibold">Timesheets in this period</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Each timesheet can create at most one payroll run. Once a draft exists, Finance takes over approval.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          {['Employee', 'Outlet', 'Labor input', 'Run link'].map((header) => (
                            <th key={header} className="px-4 py-2.5 text-left text-[11px]">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceLoading && timesheetRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              Loading timesheets…
                            </td>
                          </tr>
                        ) : timesheetRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              No timesheets in this period yet.
                            </td>
                          </tr>
                        ) : timesheetRows.map(({ timesheet, run }) => (
                          <tr key={timesheet.id} className="border-b last:border-0">
                            <td className="px-4 py-2.5">
                              <div className="flex flex-col">
                                <span className="text-xs font-medium">{getHrUserDisplay(usersById, timesheet.userId).primary}</span>
                                <span className="text-[11px] text-muted-foreground">{getHrUserDisplay(usersById, timesheet.userId).secondary}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-col">
                                <span className="text-xs font-medium">{getHrOutletDisplay(outletsById, timesheet.outletId).primary}</span>
                                <span className="text-[11px] text-muted-foreground">{shortHrRef(timesheet.id)}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {toNumber(timesheet.workHours).toFixed(2)} hrs
                              {' · '}
                              {toNumber(timesheet.overtimeHours).toFixed(2)} OT
                              {' · '}
                              {toNumber(timesheet.lateCount)} late
                              {' · '}
                              {toNumber(timesheet.absentDays).toFixed(2)} absent
                            </td>
                            <td className="px-4 py-2.5">
                              {run ? (
                                <div className="flex flex-col gap-1">
                                  <span className={cn('inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', payrollBadgeClass(run.status))}>
                                    {formatHrEnumLabel(run.status)}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {shortHrRef(run.id)} · {formatCurrency(run.netSalary, String(run.currencyCode || 'USD'))}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">No run yet</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="surface-elevated overflow-hidden">
                  <div className="border-b px-5 py-4">
                    <h4 className="text-sm font-semibold">Runs in this period</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      HR can monitor state here, but Finance is the only workspace that approves draft payroll runs.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          {['Run', 'Employee', 'Status', 'Net salary'].map((header) => (
                            <th key={header} className={cn('px-4 py-2.5 text-[11px]', header === 'Net salary' ? 'text-right' : 'text-left')}>
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceLoading && runs.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              Loading runs…
                            </td>
                          </tr>
                        ) : runs.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              No payroll runs in this period yet.
                            </td>
                          </tr>
                        ) : runs.map((run) => (
                          <tr key={run.id} className="border-b last:border-0">
                            <td className="px-4 py-2.5 text-xs font-medium">{shortHrRef(run.id)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-col">
                                <span className="text-xs font-medium">{getHrUserDisplay(usersById, run.userId).primary}</span>
                                <span className="text-[11px] text-muted-foreground">{getHrOutletDisplay(outletsById, run.outletId).primary}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', payrollBadgeClass(run.status))}>
                                {formatHrEnumLabel(run.status)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-sm font-mono">
                              {formatCurrency(run.netSalary, String(run.currencyCode || 'USD'))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className="surface-elevated px-5 py-10">
              <EmptyState
                title="Choose a payroll window"
                description="Pick a payroll period from the left before importing labor or generating draft payroll runs."
              />
            </div>
          )}
        </section>
      </div>

      <Dialog open={periodDialogOpen} onOpenChange={setPeriodDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create payroll period</DialogTitle>
            <DialogDescription>
              Periods anchor timesheets and draft payroll runs. Create the window here before preparing labor input.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div>
              <label className="text-xs text-muted-foreground">Region</label>
              <select
                value={periodForm.regionId}
                onChange={(event) => setPeriodForm((current) => ({ ...current, regionId: event.target.value }))}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select region</option>
                {availablePeriodRegions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <input
                value={periodForm.name}
                onChange={(event) => setPeriodForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder={`${formatMonthYear(periodForm.startDate)} ${getRegionName(regionsById, periodForm.regionId || inferredRegionId)} payroll`}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="text-xs text-muted-foreground">Start date</label>
                <input
                  type="date"
                  value={periodForm.startDate}
                  onChange={(event) => setPeriodForm((current) => ({ ...current, startDate: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">End date</label>
                <input
                  type="date"
                  value={periodForm.endDate}
                  onChange={(event) => setPeriodForm((current) => ({ ...current, endDate: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Pay date</label>
                <input
                  type="date"
                  value={periodForm.payDate}
                  onChange={(event) => setPeriodForm((current) => ({ ...current, payDate: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Note</label>
              <textarea
                value={periodForm.note}
                onChange={(event) => setPeriodForm((current) => ({ ...current, note: event.target.value }))}
                className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Optional note for this payroll window"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setPeriodDialogOpen(false)}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createPeriod()}
              disabled={busyKey === 'create-period'}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busyKey === 'create-period' ? 'Creating…' : 'Create period'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
