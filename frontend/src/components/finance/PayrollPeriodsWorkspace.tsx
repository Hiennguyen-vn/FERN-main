import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  authApi,
  orgApi,
  payrollApi,
  hrApi,
  type AuthUserListItem,
  type AuthScopeView,
  type ContractView,
  type PayrollPeriodView,
  type PayrollRunView,
  type PayrollTimesheetView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { resolveScopeCurrencyCode } from '@/lib/org-currency';
import { cn } from '@/lib/utils';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PayrollPeriodsWorkspaceProps {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  onRunsChanged?: () => Promise<void> | void;
  onTimesheetsChanged?: () => Promise<void> | void;
}

interface PayrollEmployeeCandidate {
  userId: string;
  username: string;
  fullName: string;
  employeeCode?: string | null;
  outletLabels: string[];
  preferredOutletId: string;
  contract?: ContractView | null;
  source: 'contract' | 'scope';
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

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatDateTimeLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return '—';
  if (!start || !end) return [formatDateLabel(start), formatDateLabel(end)].filter(Boolean).join(' → ');
  return `${formatDateLabel(start)} → ${formatDateLabel(end)}`;
}

function formatMonthYear(value?: string | null) {
  if (!value) return 'Payroll';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Payroll';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function shortRef(prefix: string, value?: string | null) {
  const raw = String(value ?? '').trim();
  if (!raw) return `${prefix}-—`;
  return `${prefix}-${raw.slice(-6)}`;
}

function periodWindowDefaults() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const payDate = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
    payDate: formatDateInput(payDate),
  };
}

function buildDefaultPeriodForm(regionId = '') {
  const defaults = periodWindowDefaults();
  return {
    regionId,
    name: '',
    startDate: defaults.startDate,
    endDate: defaults.endDate,
    payDate: defaults.payDate,
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

function inferPeriodState(period?: PayrollPeriodView | null) {
  if (!period?.startDate || !period?.endDate) return 'planned';
  const today = formatDateInput(new Date());
  if (today < period.startDate) return 'upcoming';
  if (today > period.endDate) return 'closed';
  return 'active';
}

function toneForPeriodState(state: string) {
  switch (state) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'closed':
      return 'border-slate-200 bg-slate-100 text-slate-700';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
}

function toneForRunStatus(status: string) {
  switch (status) {
    case 'approved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'draft':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-slate-200 bg-slate-100 text-slate-700';
  }
}

function toneForTimesheetQueueState(state: 'ready' | 'run_created' | 'approved') {
  switch (state) {
    case 'approved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'run_created':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
}

function labelForTimesheetQueueState(state: 'ready' | 'run_created' | 'approved') {
  switch (state) {
    case 'approved':
      return 'approved run';
    case 'run_created':
      return 'run drafted';
    default:
      return 'ready';
  }
}

function getRegionName(regionsById: Map<string, ScopeRegion>, regionId?: string | number | null) {
  const key = String(regionId ?? '').trim();
  if (!key) return 'Unassigned region';
  return regionsById.get(key)?.name || `Region ${key}`;
}

function getOutletLabel(outletsById: Map<string, ScopeOutlet>, outletId?: string | number | null) {
  const key = String(outletId ?? '').trim();
  if (!key) return 'Region-wide';
  const outlet = outletsById.get(key);
  if (!outlet) return `Outlet ${key}`;
  return `${outlet.code} · ${outlet.name}`;
}

function buildSuggestedPeriodName(regionName: string, startDate?: string | null) {
  return `${formatMonthYear(startDate)} ${regionName} Payroll`;
}

function buildPeriodHeadline(period: PayrollPeriodView | null, regionName: string) {
  const rawName = String(period?.name || '').trim();
  if (rawName && /[A-Za-z]/.test(rawName)) return rawName;
  return buildSuggestedPeriodName(regionName, period?.startDate || period?.endDate || period?.payDate);
}

function StatStrip({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/75 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function collectRegionScopeIds(regions: ScopeRegion[], rootRegionId: string) {
  const start = String(rootRegionId || '').trim();
  if (!start) return [];
  const collected = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || collected.has(current)) continue;
    collected.add(current);
    regions.forEach((region) => {
      if (region.parentRegionId === current) {
        queue.push(region.id);
      }
    });
  }
  return [...collected];
}

function choosePreferredContract(current: ContractView | undefined, candidate: ContractView) {
  if (!current) return candidate;
  const currentStart = String(current.startDate || '');
  const candidateStart = String(candidate.startDate || '');
  return candidateStart > currentStart ? candidate : current;
}

export function PayrollPeriodsWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  onRunsChanged,
  onTimesheetsChanged,
}: PayrollPeriodsWorkspaceProps) {
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [regions, setRegions] = useState<ScopeRegion[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);
  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [authScopes, setAuthScopes] = useState<AuthScopeView[]>([]);
  const [contracts, setContracts] = useState<ContractView[]>([]);

  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState('');
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [periodsTotal, setPeriodsTotal] = useState(0);
  const [periodsHasMore, setPeriodsHasMore] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [periodTimesheets, setPeriodTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [periodRuns, setPeriodRuns] = useState<PayrollRunView[]>([]);

  const [actionBusy, setActionBusy] = useState('');
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);
  const [periodForm, setPeriodForm] = useState(buildDefaultPeriodForm(scopeRegionId || ''));
  const [timesheetForm, setTimesheetForm] = useState(buildDefaultTimesheetForm(scopeOutletId || ''));
  const [runForm, setRunForm] = useState(buildDefaultRunForm());

  const periodsQuery = useListQueryState<{ regionId?: string }>({
    initialLimit: 20,
    initialSortBy: 'startDate',
    initialSortDir: 'desc',
    initialFilters: { regionId: scopeRegionId || undefined },
  });
  const patchPeriodsFilters = periodsQuery.patchFilters;

  const regionsById = useMemo(
    () => new Map(regions.map((region) => [region.id, region])),
    [regions],
  );
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );
  const outletsById = useMemo(
    () => new Map(outlets.map((outlet) => [outlet.id, outlet])),
    [outlets],
  );

  const inferredRegionId = useMemo(() => {
    if (scopeRegionId) return scopeRegionId;
    if (!scopeOutletId) return '';
    return outlets.find((outlet) => outlet.id === scopeOutletId)?.regionId ?? '';
  }, [outlets, scopeOutletId, scopeRegionId]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const selectedRegionId = useMemo(
    () =>
      String(
        selectedPeriod?.regionId ||
          periodForm.regionId ||
          periodsQuery.filters.regionId ||
          inferredRegionId ||
          '',
      ),
    [inferredRegionId, periodForm.regionId, periodsQuery.filters.regionId, selectedPeriod?.regionId],
  );

  const selectedRegion = useMemo(
    () => regions.find((region) => region.id === selectedRegionId) ?? null,
    [regions, selectedRegionId],
  );

  const selectedRegionScopeIds = useMemo(
    () => collectRegionScopeIds(regions, selectedRegionId),
    [regions, selectedRegionId],
  );

  const selectedCurrencyCode = useMemo(
    () =>
      resolveScopeCurrencyCode({
        regions,
        outlets,
        regionId: selectedRegionId,
      }),
    [outlets, regions, selectedRegionId],
  );

  const selectedRegionName = selectedRegion?.name || getRegionName(regionsById, selectedPeriod?.regionId || selectedRegionId);

  const selectedRegionOutlets = useMemo(() => {
    if (selectedRegionScopeIds.length === 0) return outlets;
    const allowedRegionIds = new Set(selectedRegionScopeIds);
    return outlets.filter((outlet) => allowedRegionIds.has(outlet.regionId));
  }, [outlets, selectedRegionScopeIds]);

  const selectedRegionCodes = useMemo(
    () =>
      selectedRegionScopeIds
        .map((regionId) => regionsById.get(regionId)?.code)
        .filter((value): value is string => Boolean(value)),
    [regionsById, selectedRegionScopeIds],
  );

  const scopedOutletIds = useMemo(
    () => new Set(selectedRegionOutlets.map((outlet) => outlet.id)),
    [selectedRegionOutlets],
  );

  const scopedAuthScopes = useMemo(
    () => authScopes.filter((scope) => scopedOutletIds.size === 0 || scopedOutletIds.has(scope.outletId)),
    [authScopes, scopedOutletIds],
  );

  const contractsByUserId = useMemo(() => {
    const map = new Map<string, ContractView>();
    contracts.forEach((contract) => {
      const userId = String(contract.userId || '').trim();
      if (!userId) return;
      if (String(contract.status || '').toLowerCase() !== 'active') return;
      const contractRegionCode = String(contract.regionCode || '').trim();
      if (selectedRegionCodes.length > 0 && contractRegionCode && !selectedRegionCodes.includes(contractRegionCode)) {
        return;
      }
      map.set(userId, choosePreferredContract(map.get(userId), contract));
    });
    return map;
  }, [contracts, selectedRegionCodes]);

  const payrollEmployeeCandidates = useMemo(() => {
    const groupedScopes = new Map<string, AuthScopeView[]>();
    scopedAuthScopes.forEach((scope) => {
      const list = groupedScopes.get(scope.userId) || [];
      list.push(scope);
      groupedScopes.set(scope.userId, list);
    });

    const useContractFilter = contractsByUserId.size > 0;
    const candidates = new Map<string, PayrollEmployeeCandidate>();

    groupedScopes.forEach((scopes, userId) => {
      if (useContractFilter && !contractsByUserId.has(userId)) return;
      const user = usersById.get(userId);
      if (!user) return;
      const outletLabels = scopes
        .map((scope) => {
          const outlet = outletsById.get(scope.outletId);
          return outlet ? `${outlet.code} · ${outlet.name}` : scope.outletName || `Outlet ${scope.outletId}`;
        })
        .filter((label, index, all) => all.indexOf(label) === index);
      candidates.set(userId, {
        userId,
        username: user.username,
        fullName: user.fullName || user.username,
        employeeCode: user.employeeCode,
        outletLabels,
        preferredOutletId: scopes[0]?.outletId || '',
        contract: contractsByUserId.get(userId),
        source: useContractFilter ? 'contract' : 'scope',
      });
    });

    if (candidates.size === 0 && contractsByUserId.size > 0) {
      contractsByUserId.forEach((contract, userId) => {
        const user = usersById.get(userId);
        if (!user) return;
        candidates.set(userId, {
          userId,
          username: user.username,
          fullName: user.fullName || user.username,
          employeeCode: user.employeeCode,
          outletLabels: [],
          preferredOutletId: '',
          contract,
          source: 'contract',
        });
      });
    }

    return [...candidates.values()].sort((left, right) => left.fullName.localeCompare(right.fullName));
  }, [contractsByUserId, outletsById, scopedAuthScopes, usersById]);

  const payrollEmployeesById = useMemo(
    () => new Map(payrollEmployeeCandidates.map((candidate) => [candidate.userId, candidate])),
    [payrollEmployeeCandidates],
  );

  const selectedEmployee = timesheetForm.userId ? payrollEmployeesById.get(timesheetForm.userId) : undefined;

  const periodRunsByTimesheetId = useMemo(
    () =>
      new Map(
        periodRuns
          .filter((run) => String(run.payrollTimesheetId || '').trim())
          .map((run) => [String(run.payrollTimesheetId), run]),
      ),
    [periodRuns],
  );

  const availableRunTimesheets = useMemo(
    () => periodTimesheets.filter((timesheet) => !periodRunsByTimesheetId.has(String(timesheet.id))),
    [periodRunsByTimesheetId, periodTimesheets],
  );

  const workspaceStats = useMemo(() => {
    const projectedPayroll = periodRuns.reduce((sum, run) => sum + toNumber(run.netSalary), 0);
    const totalHours = periodTimesheets.reduce((sum, timesheet) => sum + toNumber(timesheet.workHours), 0);
    const overtimeHours = periodTimesheets.reduce((sum, timesheet) => sum + toNumber(timesheet.overtimeHours), 0);
    const approvedRuns = periodRuns.filter((run) => String(run.status || '').toLowerCase() === 'approved').length;
    return {
      projectedPayroll,
      totalHours,
      overtimeHours,
      approvedRuns,
      pendingRuns: Math.max(periodRuns.length - approvedRuns, 0),
      readyTimesheets: availableRunTimesheets.length,
    };
  }, [availableRunTimesheets.length, periodRuns, periodTimesheets]);

  const selectedRunSource = useMemo(
    () => periodTimesheets.find((timesheet) => timesheet.id === runForm.payrollTimesheetId) ?? null,
    [periodTimesheets, runForm.payrollTimesheetId],
  );
  const selectedRunUser = selectedRunSource?.userId ? usersById.get(selectedRunSource.userId) : undefined;
  const selectedRunOutletLabel = getOutletLabel(outletsById, selectedRunSource?.outletId);
  const selectedRunContract = selectedRunSource?.userId
    ? contractsByUserId.get(String(selectedRunSource.userId))
    : undefined;

  const periodDraftRegionName = useMemo(
    () => getRegionName(regionsById, periodForm.regionId || selectedRegionId),
    [periodForm.regionId, regionsById, selectedRegionId],
  );
  const resolvedPeriodName = useMemo(
    () => {
      const rawName = periodForm.name.trim();
      return rawName || buildSuggestedPeriodName(periodDraftRegionName, periodForm.startDate);
    },
    [periodDraftRegionName, periodForm.name, periodForm.startDate],
  );

  const openPeriodDialog = useCallback(() => {
    setPeriodForm((current) => {
      if (current.regionId) return current;
      return { ...current, regionId: selectedRegionId || inferredRegionId || '' };
    });
    setPeriodDialogOpen(true);
  }, [inferredRegionId, selectedRegionId]);

  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const [hierarchy, usersPage, scopesPage, activeContracts] = await Promise.all([
        orgApi.hierarchy(token),
        authApi.users(token, { limit: 200, status: 'active' }),
        authApi.scopes(token, { limit: 400, status: 'active' }),
        hrApi.contractsActive(token),
      ]);
      setRegions(hierarchy.regions || []);
      setOutlets(hierarchy.outlets || []);
      setUsers(
        [...(usersPage.items || [])].sort((left, right) =>
          String(left.fullName || left.username).localeCompare(String(right.fullName || right.username)),
        ),
      );
      setAuthScopes(scopesPage.items || []);
      setContracts(activeContracts || []);
    } catch (error: unknown) {
      console.error('Payroll directory load failed', error);
      setDirectoryError(getErrorMessage(error, 'Unable to load payroll directory'));
    } finally {
      setDirectoryLoading(false);
    }
  }, [token]);

  const loadPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    setPeriodsError('');
    try {
      const page = await payrollApi.periods(token, {
        ...periodsQuery.query,
        regionId: periodsQuery.filters.regionId,
      });
      setPeriods(page.items || []);
      setPeriodsTotal(page.total || page.totalCount || 0);
      setPeriodsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Payroll period load failed', error);
      setPeriods([]);
      setPeriodsTotal(0);
      setPeriodsHasMore(false);
      setPeriodsError(getErrorMessage(error, 'Unable to load payroll periods'));
    } finally {
      setPeriodsLoading(false);
    }
  }, [periodsQuery.filters.regionId, periodsQuery.query, token]);

  const loadWorkspace = useCallback(async () => {
    if (!selectedPeriodId) {
      setPeriodTimesheets([]);
      setPeriodRuns([]);
      setWorkspaceError('');
      return;
    }

    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const [timesheetsPage, runsPage] = await Promise.all([
        payrollApi.timesheets(token, {
          payrollPeriodId: selectedPeriodId,
          limit: 50,
          offset: 0,
          sortBy: 'createdAt',
          sortDir: 'desc',
        }),
        payrollApi.runs(token, {
          payrollPeriodId: selectedPeriodId,
          limit: 50,
          offset: 0,
          sortBy: 'createdAt',
          sortDir: 'desc',
        }),
      ]);
      setPeriodTimesheets(timesheetsPage.items || []);
      setPeriodRuns(runsPage.items || []);
    } catch (error: unknown) {
      console.error('Payroll workspace load failed', error);
      setPeriodTimesheets([]);
      setPeriodRuns([]);
      setWorkspaceError(getErrorMessage(error, 'Unable to load period activity'));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [selectedPeriodId, token]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    if (!periods.length) {
      setSelectedPeriodId('');
      return;
    }
    setSelectedPeriodId((current) =>
      periods.some((period) => period.id === current) ? current : String(periods[0].id),
    );
  }, [periods]);

  useEffect(() => {
    if (!periodsQuery.filters.regionId && inferredRegionId) {
      patchPeriodsFilters({ regionId: inferredRegionId });
    }
  }, [inferredRegionId, patchPeriodsFilters, periodsQuery.filters.regionId]);

  useEffect(() => {
    if (!periodForm.regionId && inferredRegionId) {
      setPeriodForm((current) => ({ ...current, regionId: inferredRegionId }));
    }
  }, [inferredRegionId, periodForm.regionId]);

  useEffect(() => {
    if (!selectedPeriodId) {
      setPeriodTimesheets([]);
      setPeriodRuns([]);
      return;
    }
    void loadWorkspace();
  }, [loadWorkspace, selectedPeriodId]);

  useEffect(() => {
    const fallbackOutletId =
      (scopeOutletId && selectedRegionOutlets.some((outlet) => outlet.id === scopeOutletId) ? scopeOutletId : undefined) ||
      selectedRegionOutlets[0]?.id ||
      '';
    setTimesheetForm((current) => {
      if (current.outletId && selectedRegionOutlets.some((outlet) => outlet.id === current.outletId)) {
        return current;
      }
      return { ...current, outletId: fallbackOutletId };
    });
  }, [scopeOutletId, selectedRegionOutlets]);

  useEffect(() => {
    setTimesheetForm((current) => {
      if (!current.userId) return current;
      if (payrollEmployeesById.has(current.userId)) return current;
      return { ...current, userId: '' };
    });
  }, [payrollEmployeesById]);

  useEffect(() => {
    if (!selectedEmployee?.preferredOutletId) return;
    setTimesheetForm((current) => {
      if (current.outletId) return current;
      if (!selectedRegionOutlets.some((outlet) => outlet.id === selectedEmployee.preferredOutletId)) {
        return current;
      }
      return { ...current, outletId: selectedEmployee.preferredOutletId };
    });
  }, [selectedEmployee?.preferredOutletId, selectedRegionOutlets]);

  useEffect(() => {
    setTimesheetForm((current) => ({
      ...buildDefaultTimesheetForm(current.outletId),
      outletId: current.outletId,
    }));
    setRunForm(buildDefaultRunForm());
  }, [selectedPeriodId]);

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
    setRunForm((current) =>
      current.currencyCode === selectedCurrencyCode
        ? current
        : { ...current, currencyCode: selectedCurrencyCode },
    );
  }, [selectedCurrencyCode]);

  useEffect(() => {
    if (!selectedRunSource?.userId) return;
    const contract = contractsByUserId.get(String(selectedRunSource.userId));
    setRunForm((current) => {
      const nextCurrency = String(contract?.currencyCode || selectedCurrencyCode || current.currencyCode || 'USD').toUpperCase();
      const nextBaseSalary = contract?.baseSalary != null ? String(contract.baseSalary) : current.baseSalaryAmount;
      if (current.currencyCode === nextCurrency && current.baseSalaryAmount === nextBaseSalary) {
        return current;
      }
      return {
        ...current,
        currencyCode: nextCurrency,
        baseSalaryAmount: nextBaseSalary,
      };
    });
  }, [contractsByUserId, selectedCurrencyCode, selectedRunSource?.id, selectedRunSource?.userId]);

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

    setActionBusy('create-period');
    try {
      const created = await payrollApi.createPeriod(token, {
        regionId: periodForm.regionId,
        name: resolvedPeriodName,
        startDate: periodForm.startDate,
        endDate: periodForm.endDate,
        payDate: periodForm.payDate || null,
        note: periodForm.note.trim() || null,
      });
      toast.success('Payroll period created');
      setSelectedPeriodId(created.id);
      setPeriodDialogOpen(false);
      setPeriodForm(buildDefaultPeriodForm(periodForm.regionId));
      await loadPeriods();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create payroll period'));
    } finally {
      setActionBusy('');
    }
  };

  const createTimesheet = async () => {
    if (!selectedPeriod) {
      toast.error('Choose a payroll period first');
      return;
    }
    if (!timesheetForm.userId) {
      toast.error('Employee is required');
      return;
    }

    setActionBusy('create-timesheet');
    try {
      const created = await payrollApi.createTimesheet(token, {
        payrollPeriodId: String(selectedPeriod.id),
        userId: timesheetForm.userId,
        outletId: timesheetForm.outletId || null,
        workDays: toNumber(timesheetForm.workDays),
        workHours: toNumber(timesheetForm.workHours),
        overtimeHours: toNumber(timesheetForm.overtimeHours),
        overtimeRate: toNumber(timesheetForm.overtimeRate),
        lateCount: Math.max(0, Math.trunc(toNumber(timesheetForm.lateCount))),
        absentDays: toNumber(timesheetForm.absentDays),
      });
      toast.success('Timesheet logged');
      setTimesheetForm(buildDefaultTimesheetForm(timesheetForm.outletId));
      setRunForm((current) => ({ ...current, payrollTimesheetId: created.id }));
      await Promise.all([
        loadWorkspace(),
        onTimesheetsChanged ? Promise.resolve(onTimesheetsChanged()) : Promise.resolve(),
      ]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create timesheet'));
    } finally {
      setActionBusy('');
    }
  };

  const generateRun = async () => {
    if (!selectedPeriod) {
      toast.error('Choose a payroll period first');
      return;
    }
    if (!runForm.payrollTimesheetId) {
      toast.error('Choose a timesheet');
      return;
    }
    if (toNumber(runForm.baseSalaryAmount) <= 0 || toNumber(runForm.netSalary) <= 0) {
      toast.error('Base salary and net salary must be greater than zero');
      return;
    }

    setActionBusy('generate-run');
    try {
      await payrollApi.generateRun(token, {
        payrollTimesheetId: runForm.payrollTimesheetId,
        currencyCode: runForm.currencyCode,
        baseSalaryAmount: toNumber(runForm.baseSalaryAmount),
        netSalary: toNumber(runForm.netSalary),
        note: runForm.note.trim() || null,
      });
      toast.success('Payroll run generated');
      setRunForm((current) => ({
        ...buildDefaultRunForm(),
        currencyCode: current.currencyCode,
      }));
      await Promise.all([
        loadWorkspace(),
        onRunsChanged ? Promise.resolve(onRunsChanged()) : Promise.resolve(),
      ]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to generate payroll run'));
    } finally {
      setActionBusy('');
    }
  };

  const approveRun = async (payrollId: string) => {
    setActionBusy(`approve:${payrollId}`);
    try {
      await payrollApi.approveRun(token, payrollId);
      toast.success('Payroll run approved');
      await Promise.all([
        loadWorkspace(),
        onRunsChanged ? Promise.resolve(onRunsChanged()) : Promise.resolve(),
      ]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to approve payroll run'));
    } finally {
      setActionBusy('');
    }
  };

  const selectedPeriodState = inferPeriodState(selectedPeriod);
  const selectedPeriodHeadline = buildPeriodHeadline(selectedPeriod, selectedRegionName);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="surface-elevated flex min-h-[760px] flex-col overflow-hidden">
          <div className="border-b px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Payroll periods</div>
                <h3 className="mt-2 text-lg font-semibold tracking-tight">Choose the payroll window</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Periods anchor timesheets and payroll runs. Start here before logging labor.
                </p>
              </div>

              <button
                onClick={openPeriodDialog}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={periodsQuery.searchInput}
                  onChange={(event) => periodsQuery.setSearchInput(event.target.value)}
                  placeholder="Search payroll periods"
                  className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                />
              </div>

              <div className="flex gap-2">
                <select
                  value={periodsQuery.filters.regionId || 'all'}
                  onChange={(event) =>
                    periodsQuery.setFilter(
                      'regionId',
                      event.target.value === 'all' ? undefined : event.target.value,
                    )
                  }
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All regions</option>
                  {regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => void loadPeriods()}
                  disabled={periodsLoading}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', periodsLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>

            {directoryError ? <p className="mt-3 text-xs text-destructive">{directoryError}</p> : null}
            {periodsError ? <p className="mt-2 text-xs text-destructive">{periodsError}</p> : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {directoryLoading || periodsLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="animate-pulse rounded-xl border border-border/60 bg-muted/20 p-4">
                    <div className="h-4 w-32 rounded bg-muted" />
                    <div className="mt-3 h-3 w-40 rounded bg-muted" />
                    <div className="mt-2 h-3 w-24 rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : periods.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
                <Calendar className="h-9 w-9 text-muted-foreground" />
                <h4 className="mt-4 text-base font-semibold">No payroll periods in this scope</h4>
                <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                  Create the next payroll window first. Timesheets and payroll runs will attach to it.
                </p>
                <button
                  onClick={openPeriodDialog}
                  className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                >
                  <Plus className="h-4 w-4" />
                  Create payroll period
                </button>
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {periods.map((period) => {
                  const periodRegionName = getRegionName(regionsById, period.regionId);
                  const periodCurrency = resolveScopeCurrencyCode({
                    regions,
                    outlets,
                    regionId: String(period.regionId || ''),
                  });
                  const periodState = inferPeriodState(period);
                  const isActive = period.id === selectedPeriodId;
                  const headline = buildPeriodHeadline(period, periodRegionName);

                  return (
                    <button
                      key={period.id}
                      onClick={() => setSelectedPeriodId(period.id)}
                      className={cn(
                        'w-full rounded-2xl border p-4 text-left transition-all hover:border-primary/40 hover:bg-accent/30',
                        isActive
                          ? 'border-primary/40 bg-primary/5 shadow-[0_0_0_1px_rgba(59,130,246,0.1)]'
                          : 'border-border/70 bg-background',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{headline}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{periodRegionName}</div>
                        </div>
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize',
                            toneForPeriodState(periodState),
                          )}
                        >
                          {periodState}
                        </span>
                      </div>

                      <div className="mt-3 text-xs text-muted-foreground">
                        {formatDateRange(period.startDate, period.endDate)}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{shortRef('PER', period.id)}</span>
                        <span>{periodCurrency}</span>
                        <span>Pay {formatDateLabel(period.payDate)}</span>
                      </div>

                      {period.note?.trim() ? (
                        <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{period.note}</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t px-4 py-3">
            <ListPaginationControls
              total={periodsTotal}
              limit={periodsQuery.limit}
              offset={periodsQuery.offset}
              hasMore={periodsHasMore}
              disabled={periodsLoading}
              onPageChange={periodsQuery.setPage}
              onLimitChange={periodsQuery.setPageSize}
            />
          </div>
        </aside>

        <section className="space-y-5">
          {selectedPeriod ? (
            <>
              <div className="surface-elevated overflow-hidden">
                <div className="flex flex-col gap-4 border-b px-5 py-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>Payroll desk</span>
                    </div>

                    <div>
                      <h3 className="text-2xl font-semibold tracking-tight">{selectedPeriodHeadline}</h3>
                      {selectedPeriod.name && selectedPeriod.name !== selectedPeriodHeadline ? (
                        <p className="mt-1 text-sm text-muted-foreground">Saved as {selectedPeriod.name}</p>
                      ) : null}
                    </div>

                    <p className="max-w-3xl text-sm text-muted-foreground">
                      Use this workspace in sequence: log timesheets for the period, generate payroll runs from those
                      timesheets, then approve the runs that are ready to pay out.
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize',
                          toneForPeriodState(selectedPeriodState),
                        )}
                      >
                        {selectedPeriodState}
                      </span>
                      <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {selectedRegionName}
                      </span>
                      <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {selectedCurrencyCode}
                      </span>
                      <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        Pay date {formatDateLabel(selectedPeriod.payDate)}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => void loadWorkspace()}
                      disabled={workspaceLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                    >
                      <RefreshCw className={cn('h-4 w-4', workspaceLoading ? 'animate-spin' : '')} />
                      Refresh workspace
                    </button>
                    <button
                      onClick={openPeriodDialog}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                    >
                      <Plus className="h-4 w-4" />
                      New period
                    </button>
                  </div>
                </div>

                <div className="grid gap-px bg-border md:grid-cols-4">
                  <div className="bg-background px-5 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Step 1</div>
                    <div className="mt-2 text-base font-semibold">{formatDateRange(selectedPeriod.startDate, selectedPeriod.endDate)}</div>
                    <p className="mt-1 text-xs text-muted-foreground">Current payroll window for {selectedRegionName}</p>
                  </div>
                  <div className="bg-background px-5 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Step 2</div>
                    <div className="mt-2 text-base font-semibold">{periodTimesheets.length} timesheets</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {workspaceStats.totalHours.toFixed(2)} labor hours logged
                    </p>
                  </div>
                  <div className="bg-background px-5 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Step 3</div>
                    <div className="mt-2 text-base font-semibold">{workspaceStats.pendingRuns} draft runs</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {workspaceStats.readyTimesheets} timesheets still need a run
                    </p>
                  </div>
                  <div className="bg-background px-5 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Step 4</div>
                    <div className="mt-2 text-base font-semibold">{workspaceStats.approvedRuns} approved</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatCurrency(workspaceStats.projectedPayroll, selectedCurrencyCode)} scheduled
                    </p>
                  </div>
                </div>

                {workspaceError ? <p className="px-5 py-3 text-xs text-destructive">{workspaceError}</p> : null}
              </div>

              <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="surface-elevated overflow-hidden">
                  <div className="border-b px-5 py-4">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span>Step 2 · Log timesheets</span>
                    </div>
                    <h4 className="mt-2 text-lg font-semibold">Capture labor for this payroll period</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Timesheets are the direct source for payroll runs. Backend does not require a separate timesheet
                      approval step, so log the labor here and then move into payroll generation.
                    </p>
                  </div>

                  <div className="border-b bg-muted/20 px-5 py-5">
                    <div className="mb-4 rounded-xl border border-border/70 bg-background/80 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Employee source</div>
                      <p className="mt-2 text-sm text-foreground">
                        {contractsByUserId.size > 0
                          ? `Using ${payrollEmployeeCandidates.length} scoped employees backed by active HR contracts.`
                          : 'No active HR contracts are seeded for this payroll scope yet, so the picker is falling back to scoped user accounts.'}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedRegionOutlets.length > 0
                          ? `Eligible outlets in this payroll scope: ${selectedRegionOutlets.map((outlet) => outlet.code).join(', ')}`
                          : 'This period is currently operating without outlet-specific scope.'}
                      </p>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Employee</label>
                        <select
                          value={timesheetForm.userId}
                          onChange={(event) =>
                            setTimesheetForm((current) => ({ ...current, userId: event.target.value }))
                          }
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Select employee</option>
                          {payrollEmployeeCandidates.map((employee) => (
                            <option key={employee.userId} value={employee.userId}>
                              {employee.fullName} {employee.employeeCode ? `· ${employee.employeeCode}` : ''}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {payrollEmployeeCandidates.length > 0
                            ? 'Only employees in the current payroll scope appear here.'
                            : 'No scoped employees available for this payroll period yet.'}
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground">Outlet</label>
                        <select
                          value={timesheetForm.outletId}
                          onChange={(event) =>
                            setTimesheetForm((current) => ({ ...current, outletId: event.target.value }))
                          }
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Region-wide</option>
                          {selectedRegionOutlets.map((outlet) => (
                            <option key={outlet.id} value={outlet.id}>
                              {outlet.code} · {outlet.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {selectedEmployee ? (
                      <div className="mt-4 rounded-xl border border-border/70 bg-background/80 p-4">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          <Users className="h-3.5 w-3.5" />
                          <span>Selected employee</span>
                        </div>
                        <div className="mt-3 text-sm font-semibold">{selectedEmployee.fullName}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {selectedEmployee.employeeCode || selectedEmployee.username}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          {selectedEmployee.contract ? (
                            <>
                              <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1">
                                {selectedEmployee.contract.employmentType || 'contract'}
                              </span>
                              <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1">
                                Base {formatCurrency(selectedEmployee.contract.baseSalary, selectedEmployee.contract.currencyCode || selectedCurrencyCode)}
                              </span>
                            </>
                          ) : (
                            <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1">
                              No HR contract linked in this environment
                            </span>
                          )}
                          {selectedEmployee.outletLabels.slice(0, 2).map((label) => (
                            <span
                              key={label}
                              className="inline-flex rounded-full border border-border bg-background px-2.5 py-1"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Work days</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={timesheetForm.workDays}
                          onChange={(event) =>
                            setTimesheetForm((current) => ({ ...current, workDays: event.target.value }))
                          }
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Work hours</label>
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          value={timesheetForm.workHours}
                          onChange={(event) =>
                            setTimesheetForm((current) => ({ ...current, workHours: event.target.value }))
                          }
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Overtime hours</label>
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          value={timesheetForm.overtimeHours}
                          onChange={(event) =>
                            setTimesheetForm((current) => ({ ...current, overtimeHours: event.target.value }))
                          }
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">OT multiplier</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={timesheetForm.overtimeRate}
                          onChange={(event) =>
                            setTimesheetForm((current) => ({ ...current, overtimeRate: event.target.value }))
                          }
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Late count</label>
                        <input
                          type="number"
                          min="0"
                          value={timesheetForm.lateCount}
                          onChange={(event) =>
                            setTimesheetForm((current) => ({ ...current, lateCount: event.target.value }))
                          }
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Absent days</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={timesheetForm.absentDays}
                          onChange={(event) =>
                            setTimesheetForm((current) => ({ ...current, absentDays: event.target.value }))
                          }
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        Keep logging timesheets until every scoped employee in the period has labor input recorded.
                      </p>
                      <button
                        onClick={() => void createTimesheet()}
                        disabled={actionBusy === 'create-timesheet' || !selectedPeriod || payrollEmployeeCandidates.length === 0}
                        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
                      >
                        {actionBusy === 'create-timesheet' ? 'Saving timesheet...' : 'Log timesheet'}
                      </button>
                    </div>
                  </div>

                  <div className="divide-y">
                    {workspaceLoading && periodTimesheets.length === 0 ? (
                      <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading period timesheets...
                      </div>
                    ) : periodTimesheets.length === 0 ? (
                      <div className="px-5 py-12 text-center">
                        <Users className="mx-auto h-8 w-8 text-muted-foreground" />
                        <h5 className="mt-4 text-base font-semibold">No labor has been logged yet</h5>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Start with the first employee timesheet, then use the next panel to generate payroll runs.
                        </p>
                      </div>
                    ) : (
                      periodTimesheets.map((timesheet) => {
                        const user = timesheet.userId ? usersById.get(timesheet.userId) : undefined;
                        const employee = timesheet.userId ? payrollEmployeesById.get(timesheet.userId) : undefined;
                        const linkedRun = periodRunsByTimesheetId.get(String(timesheet.id));
                        const queueState =
                          linkedRun && String(linkedRun.status || '').toLowerCase() === 'approved'
                            ? 'approved'
                            : linkedRun
                              ? 'run_created'
                              : 'ready';

                        return (
                          <div
                            key={timesheet.id}
                            className="flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-accent/20"
                          >
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold">
                                    {user?.fullName || user?.username || `User ${timesheet.userId}`}
                                  </span>
                                  <span
                                    className={cn(
                                      'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium',
                                      toneForTimesheetQueueState(queueState),
                                    )}
                                  >
                                    {labelForTimesheetQueueState(queueState)}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {shortRef('TS', timesheet.id)} · {getOutletLabel(outletsById, timesheet.outletId)}
                                  {employee?.employeeCode ? ` · ${employee.employeeCode}` : ''}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {!linkedRun ? (
                                  <button
                                    onClick={() =>
                                      setRunForm((current) => ({
                                        ...current,
                                        payrollTimesheetId: String(timesheet.id),
                                      }))
                                    }
                                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent"
                                  >
                                    Use for run
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  </button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {shortRef('RUN', linkedRun.id)} · {String(linkedRun.status || 'draft')}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="grid gap-3 text-sm sm:grid-cols-3">
                              <StatStrip
                                label="Hours"
                                value={toNumber(timesheet.workHours).toFixed(2)}
                                hint={`${toNumber(timesheet.workDays).toFixed(2)} work days`}
                              />
                              <StatStrip
                                label="Overtime"
                                value={toNumber(timesheet.overtimeHours).toFixed(2)}
                                hint={`Rate x${toNumber(timesheet.overtimeRate).toFixed(2)}`}
                              />
                              <StatStrip
                                label="Exceptions"
                                value={`${toNumber(timesheet.lateCount)} late`}
                                hint={`${toNumber(timesheet.absentDays).toFixed(2)} absent days`}
                              />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="surface-elevated overflow-hidden">
                    <div className="border-b px-5 py-4">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        <span>Step 3 · Generate payroll runs</span>
                      </div>
                      <h4 className="mt-2 text-lg font-semibold">Turn approved labor input into payroll</h4>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Each timesheet can generate one payroll run. Draft runs remain here until you approve them.
                      </p>
                    </div>

                    <div className="border-b bg-muted/20 px-5 py-5">
                      <div className="grid gap-4">
                        <div>
                          <label className="text-xs text-muted-foreground">Timesheet</label>
                          <select
                            value={runForm.payrollTimesheetId}
                            onChange={(event) =>
                              setRunForm((current) => ({
                                ...current,
                                payrollTimesheetId: event.target.value,
                              }))
                            }
                            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="">Select timesheet</option>
                            {availableRunTimesheets.map((timesheet) => {
                              const user = timesheet.userId ? usersById.get(timesheet.userId) : undefined;
                              return (
                                <option key={timesheet.id} value={timesheet.id}>
                                  {user?.fullName || user?.username || shortRef('TS', timesheet.id)} · {toNumber(timesheet.workHours).toFixed(2)} hrs
                                </option>
                              );
                            })}
                          </select>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Only timesheets without an existing run appear here.
                          </p>
                        </div>

                        {selectedRunSource ? (
                          <div className="rounded-xl border border-border/70 bg-background/80 p-4">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              <Users className="h-3.5 w-3.5" />
                              <span>Selected labor input</span>
                            </div>
                            <div className="mt-3 text-sm font-semibold">
                              {selectedRunUser?.fullName || selectedRunUser?.username || `User ${selectedRunSource.userId}`}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {selectedRunOutletLabel} · {shortRef('TS', selectedRunSource.id)}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              {selectedRunContract ? (
                                <>
                                  <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1">
                                    {selectedRunContract.employmentType || 'contract'}
                                  </span>
                                  <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1">
                                    Base {formatCurrency(selectedRunContract.baseSalary, selectedRunContract.currencyCode || selectedCurrencyCode)}
                                  </span>
                                </>
                              ) : (
                                <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1">
                                  Salary will be entered manually
                                </span>
                              )}
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <StatStrip
                                label="Work hours"
                                value={toNumber(selectedRunSource.workHours).toFixed(2)}
                                hint={`${toNumber(selectedRunSource.workDays).toFixed(2)} work days`}
                              />
                              <StatStrip
                                label="Overtime"
                                value={toNumber(selectedRunSource.overtimeHours).toFixed(2)}
                                hint={`Rate x${toNumber(selectedRunSource.overtimeRate).toFixed(2)}`}
                              />
                              <StatStrip
                                label="Exceptions"
                                value={`${toNumber(selectedRunSource.lateCount)} late`}
                                hint={`${toNumber(selectedRunSource.absentDays).toFixed(2)} absent days`}
                              />
                            </div>
                          </div>
                        ) : null}

                        <div className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <label className="text-xs text-muted-foreground">Currency</label>
                            <input
                              readOnly
                              aria-readonly="true"
                              value={runForm.currencyCode}
                              className="mt-1 h-10 w-full rounded-md border border-input bg-muted/40 px-3 text-sm"
                            />
                          <p className="mt-1 text-[11px] text-muted-foreground">Auto from {selectedRegionName}</p>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Base salary</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={runForm.baseSalaryAmount}
                              onChange={(event) =>
                                setRunForm((current) => ({ ...current, baseSalaryAmount: event.target.value }))
                              }
                              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            />
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {selectedRunContract
                                ? 'Prefilled from the active HR contract. You can override before generating the run.'
                                : 'No contract salary found, so this stays manual.'}
                            </p>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Net salary</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={runForm.netSalary}
                              onChange={(event) =>
                                setRunForm((current) => ({ ...current, netSalary: event.target.value }))
                              }
                              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs text-muted-foreground">Run note</label>
                          <textarea
                            value={runForm.note}
                            onChange={(event) => setRunForm((current) => ({ ...current, note: event.target.value }))}
                            placeholder="Optional payroll note"
                            className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                        </div>

                        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs text-muted-foreground">
                            Once a run exists for a timesheet, backend blocks duplicate payroll generation for that
                            source entry.
                          </p>
                          <button
                            onClick={() => void generateRun()}
                            disabled={actionBusy === 'generate-run' || availableRunTimesheets.length === 0}
                            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
                          >
                            {actionBusy === 'generate-run' ? 'Generating run...' : 'Generate payroll run'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="divide-y">
                      {workspaceLoading && periodRuns.length === 0 ? (
                        <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading payroll runs...
                        </div>
                      ) : periodRuns.length === 0 ? (
                        <div className="px-5 py-12 text-center">
                          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
                          <h5 className="mt-4 text-base font-semibold">No payroll runs yet</h5>
                          <p className="mt-2 text-sm text-muted-foreground">
                            As soon as a timesheet is logged, select it above and generate the corresponding payroll
                            run here.
                          </p>
                        </div>
                      ) : (
                        periodRuns.map((run) => {
                          const status = String(run.status || 'draft').toLowerCase();
                          const sourceTimesheet = periodTimesheets.find(
                            (timesheet) => timesheet.id === run.payrollTimesheetId,
                          );
                          const sourceUser = sourceTimesheet?.userId ? usersById.get(sourceTimesheet.userId) : undefined;

                          return (
                            <div
                              key={run.id}
                              className="flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-accent/20"
                            >
                              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold">
                                      {sourceUser?.fullName || sourceUser?.username || shortRef('RUN', run.id)}
                                    </span>
                                    <span
                                      className={cn(
                                        'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize',
                                        toneForRunStatus(status),
                                      )}
                                    >
                                      {status}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {shortRef('RUN', run.id)} · {shortRef('TS', run.payrollTimesheetId)} ·{' '}
                                    {getOutletLabel(outletsById, run.outletId || sourceTimesheet?.outletId)}
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  {status === 'draft' ? (
                                    <button
                                      onClick={() => void approveRun(run.id)}
                                      disabled={actionBusy === `approve:${run.id}`}
                                      className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
                                    >
                                      {actionBusy === `approve:${run.id}` ? 'Approving...' : 'Approve run'}
                                    </button>
                                  ) : null}
                                </div>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-3">
                                <StatStrip
                                  label="Base salary"
                                  value={formatCurrency(run.baseSalaryAmount, run.currencyCode || selectedCurrencyCode)}
                                  hint={run.currencyCode || selectedCurrencyCode}
                                />
                                <StatStrip
                                  label="Net salary"
                                  value={formatCurrency(run.netSalary, run.currencyCode || selectedCurrencyCode)}
                                  hint={status === 'approved' ? `Approved ${formatDateTimeLabel(run.approvedAt)}` : 'Awaiting approval'}
                                />
                                <StatStrip
                                  label="Recorded"
                                  value={formatDateTimeLabel(run.createdAt)}
                                  hint={run.note?.trim() || 'No payroll note'}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="surface-elevated flex min-h-[760px] flex-col items-center justify-center px-8 py-16 text-center">
              <Calendar className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-5 text-xl font-semibold">Open a payroll period to start operating</h3>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Payroll periods are the only real anchor in the backend flow. Once a period exists, this workspace will
                let you log timesheets, generate payroll runs, and approve payouts without jumping across tabs.
              </p>
              <button
                onClick={openPeriodDialog}
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
              >
                <Plus className="h-4 w-4" />
                Create payroll period
              </button>
            </div>
          )}
        </section>
      </div>

      <Dialog open={periodDialogOpen} onOpenChange={setPeriodDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Open a new payroll period</DialogTitle>
            <DialogDescription>
              Create the period first, then log timesheets and generate payroll runs inside the selected workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <label className="text-xs text-muted-foreground">Region</label>
                <select
                  value={periodForm.regionId}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, regionId: event.target.value }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select region</option>
                  {regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name} · {String(region.currencyCode || 'USD').toUpperCase()}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Currency follows the selected region: {resolveScopeCurrencyCode({ regions, outlets, regionId: periodForm.regionId || selectedRegionId })}
                </p>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Pay date</label>
                <input
                  type="date"
                  value={periodForm.payDate}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, payDate: event.target.value }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Must be on or after the period end date.</p>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Period name</label>
              <input
                value={periodForm.name}
                onChange={(event) => setPeriodForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={resolvedPeriodName}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave it blank and we will save it as {resolvedPeriodName}.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Start date</label>
                <input
                  type="date"
                  value={periodForm.startDate}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, startDate: event.target.value }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">End date</label>
                <input
                  type="date"
                  value={periodForm.endDate}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, endDate: event.target.value }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Preview</div>
              <div className="mt-2 text-lg font-semibold">{resolvedPeriodName}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {periodDraftRegionName} · {formatDateRange(periodForm.startDate, periodForm.endDate)}
              </p>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Operational note</label>
              <textarea
                value={periodForm.note}
                onChange={(event) => setPeriodForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Optional note about payout timing, exceptions, or staffing context"
                className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => setPeriodDialogOpen(false)}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={() => void createPeriod()}
              disabled={actionBusy === 'create-period'}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {actionBusy === 'create-period' ? 'Creating period...' : 'Create payroll period'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
