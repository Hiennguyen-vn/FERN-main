import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  DollarSign,
  FileText,
  Loader2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Search,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  financeApi,
  orgApi,
  payrollApi,
  type CreateExpensePayload,
  type ExpenseView,
  type PayrollRunView,
  type PayrollTimesheetView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { PayrollPeriodsWorkspace } from '@/components/finance/PayrollPeriodsWorkspace';
import { resolveScopeCurrencyCode } from '@/lib/org-currency';

type FinanceTab = 'expenses' | 'periods' | 'timesheets' | 'runs' | 'config';

const TABS: { key: FinanceTab; label: string; icon: React.ElementType }[] = [
  { key: 'expenses', label: 'Expense Ledger', icon: DollarSign },
  { key: 'periods', label: 'Payroll Periods', icon: Calendar },
  { key: 'timesheets', label: 'Timesheets', icon: Clock },
  { key: 'runs', label: 'Payroll Runs', icon: FileText },
  { key: 'config', label: 'Configuration', icon: ShieldAlert },
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

export function FinanceModule() {
  const { token, scope } = useShellRuntime();
  const regionId = normalizeNumeric(scope.regionId);
  const outletId = normalizeNumeric(scope.outletId);

  const [activeTab, setActiveTab] = useState<FinanceTab>('expenses');
  const [regions, setRegions] = useState<ScopeRegion[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);

  const [expensesLoading, setExpensesLoading] = useState(false);
  const [expensesError, setExpensesError] = useState('');
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [expensesHasMore, setExpensesHasMore] = useState(false);

  const [timesheetsLoading, setTimesheetsLoading] = useState(false);
  const [timesheetsError, setTimesheetsError] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [timesheetsTotal, setTimesheetsTotal] = useState(0);
  const [timesheetsHasMore, setTimesheetsHasMore] = useState(false);

  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [runs, setRuns] = useState<PayrollRunView[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsHasMore, setRunsHasMore] = useState(false);

  const [actionBusy, setActionBusy] = useState('');
  const [expenseForm, setExpenseForm] = useState({
    sourceType: 'operating',
    amount: '',
    currencyCode: 'USD',
    description: '',
    businessDate: new Date().toISOString().slice(0, 10),
  });

  const expensesQuery = useListQueryState<{ outletId?: string; sourceType?: string }>({
    initialLimit: 20,
    initialSortBy: 'businessDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, sourceType: undefined },
  });
  const timesheetsQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined },
  });
  const runsQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const patchExpensesFilters = expensesQuery.patchFilters;
  const patchTimesheetsFilters = timesheetsQuery.patchFilters;
  const patchRunsFilters = runsQuery.patchFilters;
  const applyTimesheetSort = timesheetsQuery.applySort;
  const applyRunSort = runsQuery.applySort;
  const timesheetSortBy = timesheetsQuery.sortBy;
  const runSortBy = runsQuery.sortBy;
  const expenseCurrencyCode = useMemo(
    () =>
      resolveScopeCurrencyCode({
        regions,
        outlets,
        regionId,
        outletId,
      }),
    [outletId, outlets, regionId, regions],
  );
  const expenseCurrencyContext = useMemo(() => {
    if (outletId) {
      const outlet = outlets.find((candidate) => candidate.id === outletId);
      const outletRegion = outlet ? regions.find((candidate) => candidate.id === outlet.regionId) : undefined;
      return outlet && outletRegion ? `${outlet.code} · ${outletRegion.name}` : 'selected outlet';
    }
    if (regionId) {
      return regions.find((candidate) => candidate.id === regionId)?.name || 'selected region';
    }
    return 'current scope';
  }, [outletId, outlets, regionId, regions]);

  const loadExpenses = useCallback(async () => {
    if (!token) return;
    setExpensesLoading(true);
    setExpensesError('');
    try {
      const page = await financeApi.expenses(token, {
        ...expensesQuery.query,
        outletId: outletId || undefined,
        sourceType: expensesQuery.filters.sourceType,
      });
      setExpenses(page.items || []);
      setExpensesTotal(page.total || page.totalCount || 0);
      setExpensesHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Finance expenses load failed', error);
      setExpenses([]);
      setExpensesTotal(0);
      setExpensesHasMore(false);
      setExpensesError(getErrorMessage(error, 'Unable to load expenses'));
    } finally {
      setExpensesLoading(false);
    }
  }, [expensesQuery.filters.sourceType, expensesQuery.query, outletId, token]);

  const loadTimesheets = useCallback(async () => {
    if (!token) return;
    setTimesheetsLoading(true);
    setTimesheetsError('');
    try {
      const page = await payrollApi.timesheets(token, {
        ...timesheetsQuery.query,
        outletId: outletId || undefined,
      });
      setTimesheets(page.items || []);
      setTimesheetsTotal(page.total || page.totalCount || 0);
      setTimesheetsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Finance timesheets load failed', error);
      setTimesheets([]);
      setTimesheetsTotal(0);
      setTimesheetsHasMore(false);
      setTimesheetsError(getErrorMessage(error, 'Unable to load timesheets'));
    } finally {
      setTimesheetsLoading(false);
    }
  }, [outletId, timesheetsQuery.query, token]);

  const loadRuns = useCallback(async () => {
    if (!token) return;
    setRunsLoading(true);
    setRunsError('');
    try {
      const page = await payrollApi.runs(token, {
        ...runsQuery.query,
        outletId: outletId || undefined,
        status: runsQuery.filters.status,
      });
      setRuns(page.items || []);
      setRunsTotal(page.total || page.totalCount || 0);
      setRunsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Finance payroll runs load failed', error);
      setRuns([]);
      setRunsTotal(0);
      setRunsHasMore(false);
      setRunsError(getErrorMessage(error, 'Unable to load payroll runs'));
    } finally {
      setRunsLoading(false);
    }
  }, [outletId, runsQuery.filters.status, runsQuery.query, token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void orgApi.hierarchy(token)
      .then((hierarchy) => {
        if (!active) return;
        setRegions(hierarchy.regions || []);
        setOutlets(hierarchy.outlets || []);
      })
      .catch((error: unknown) => {
        console.error('Finance org hierarchy load failed', error);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    patchExpensesFilters({ outletId: outletId || undefined });
    patchTimesheetsFilters({ outletId: outletId || undefined });
    patchRunsFilters({ outletId: outletId || undefined });
  }, [outletId, patchExpensesFilters, patchRunsFilters, patchTimesheetsFilters]);

  useEffect(() => {
    if (!timesheetSortBy || timesheetSortBy === 'id') {
      applyTimesheetSort('createdAt', 'desc');
    }
  }, [applyTimesheetSort, timesheetSortBy]);

  useEffect(() => {
    if (!runSortBy || runSortBy === 'id') {
      applyRunSort('createdAt', 'desc');
    }
  }, [applyRunSort, runSortBy]);

  useEffect(() => {
    setExpenseForm((current) =>
      current.currencyCode === expenseCurrencyCode
        ? current
        : { ...current, currencyCode: expenseCurrencyCode },
    );
  }, [expenseCurrencyCode]);

  useEffect(() => {
    if (activeTab !== 'expenses') return;
    void loadExpenses();
  }, [activeTab, loadExpenses]);

  useEffect(() => {
    if (activeTab !== 'timesheets') return;
    void loadTimesheets();
  }, [activeTab, loadTimesheets]);

  useEffect(() => {
    if (activeTab !== 'runs') return;
    void loadRuns();
  }, [activeTab, loadRuns]);

  const stats = useMemo(() => {
    const totalExpense = expenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0);
    const pendingRuns = runs.filter((run) => String(run.status || '').toLowerCase() !== 'approved').length;
    const approvedRuns = runs.filter((run) => String(run.status || '').toLowerCase() === 'approved').length;
    const overtimeHours = timesheets.reduce((sum, ts) => sum + toNumber(ts.overtimeHours), 0);

    return {
      totalExpense,
      pendingRuns,
      approvedRuns,
      overtimeHours,
    };
  }, [expenses, runs, timesheets]);

  const createExpense = async () => {
    if (!token) return;

    if (!outletId) {
      toast.error('Select an outlet scope to create expenses');
      return;
    }

    if (!expenseForm.description.trim() || toNumber(expenseForm.amount) <= 0) {
      toast.error('Description and amount are required');
      return;
    }

    setActionBusy('create-expense');
    try {
      const payload: CreateExpensePayload = {
        outletId,
        businessDate: expenseForm.businessDate,
        currencyCode: expenseForm.currencyCode,
        amount: toNumber(expenseForm.amount),
        description: expenseForm.description.trim(),
        note: null,
      };

      if (expenseForm.sourceType === 'operating') {
        await financeApi.createOperatingExpense(token, payload);
      } else {
        await financeApi.createOtherExpense(token, payload);
      }

      toast.success('Expense created');
      setExpenseForm((prev) => ({ ...prev, amount: '', description: '' }));
      await loadExpenses();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create expense'));
    } finally {
      setActionBusy('');
    }
  };

  const approveRun = async (payrollId: string) => {
    if (!token) return;
    setActionBusy(`approve:${payrollId}`);
    try {
      await payrollApi.approveRun(token, payrollId);
      toast.success('Payroll run approved');
      await loadRuns();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to approve payroll run'));
    } finally {
      setActionBusy('');
    }
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Finance" />;
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Expenses', value: formatCurrency(stats.totalExpense, expenseCurrencyCode), icon: DollarSign },
            { label: 'Pending Payroll Runs', value: String(stats.pendingRuns), icon: AlertTriangle },
            { label: 'Approved Payroll Runs', value: String(stats.approvedRuns), icon: CheckCircle2 },
            { label: 'Overtime Hours', value: stats.overtimeHours.toFixed(2), icon: Clock },
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

        {activeTab === 'expenses' ? (
          <div className="space-y-4">
            <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Type</label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={expenseForm.sourceType}
                  onChange={(event) => setExpenseForm((prev) => ({ ...prev, sourceType: event.target.value }))}
                >
                  <option value="operating">Operating</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Business Date</label>
                <input
                  type="date"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={expenseForm.businessDate}
                  onChange={(event) => setExpenseForm((prev) => ({ ...prev, businessDate: event.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Currency</label>
                <input
                  readOnly
                  aria-readonly="true"
                  title={`Auto-set from ${expenseCurrencyContext}`}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground"
                  value={expenseForm.currencyCode}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Auto from {expenseCurrencyContext}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Amount</label>
                <input
                  type="number"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={expenseForm.amount}
                  onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Description</label>
                <div className="mt-1 flex gap-2">
                  <input
                    className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    value={expenseForm.description}
                    onChange={(event) => setExpenseForm((prev) => ({ ...prev, description: event.target.value }))}
                    placeholder="Expense description"
                  />
                  <button
                    onClick={() => void createExpense()}
                    disabled={actionBusy === 'create-expense'}
                    className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60"
                  >
                    {actionBusy === 'create-expense' ? 'Saving...' : 'Create'}
                  </button>
                </div>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Expense Ledger ({expensesTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search expenses"
                      value={expensesQuery.searchInput}
                      onChange={(event) => expensesQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={expensesQuery.filters.sourceType || 'all'}
                    onChange={(event) => expensesQuery.setFilter('sourceType', event.target.value === 'all' ? undefined : event.target.value)}
                  >
                    <option value="all">All types</option>
                    <option value="operating">Operating</option>
                    <option value="other">Other</option>
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${expensesQuery.sortBy || 'businessDate'}:${expensesQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      expensesQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="businessDate:desc">Date ↓</option>
                    <option value="businessDate:asc">Date ↑</option>
                    <option value="amount:desc">Amount ↓</option>
                    <option value="amount:asc">Amount ↑</option>
                  </select>
                  <button
                    onClick={() => void loadExpenses()}
                    disabled={expensesLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', expensesLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              {expensesError ? <p className="text-xs text-destructive">{expensesError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['ID', 'Date', 'Outlet', 'Type', 'Description', 'Amount'].map((header) => (
                        <th key={header} className={cn('text-[11px] px-4 py-2.5', header === 'Amount' ? 'text-right' : 'text-left')}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expensesLoading && expenses.length === 0 ? (
                      <ListTableSkeleton columns={6} rows={6} />
                    ) : expenses.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No expenses found</td></tr>
                    ) : expenses.map((expense) => (
                      <tr key={String(expense.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(expense.id)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(expense.businessDate || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(expense.outletId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(expense.sourceType || '—')}</td>
                        <td className="px-4 py-2.5 text-sm">{String(expense.description || '—')}</td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono">
                          {formatCurrency(expense.amount, String(expense.currencyCode || 'USD'))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ListPaginationControls
                total={expensesTotal}
                limit={expensesQuery.limit}
                offset={expensesQuery.offset}
                hasMore={expensesHasMore}
                disabled={expensesLoading}
                onPageChange={expensesQuery.setPage}
                onLimitChange={expensesQuery.setPageSize}
              />
            </div>
          </div>
        ) : null}

        {activeTab === 'periods' ? (
          <PayrollPeriodsWorkspace
            token={token}
            scopeRegionId={normalizeNumeric(scope.regionId)}
            scopeOutletId={outletId || undefined}
            onRunsChanged={loadRuns}
            onTimesheetsChanged={loadTimesheets}
          />
        ) : null}

        {activeTab === 'timesheets' ? (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Timesheets ({timesheetsTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search timesheets"
                    value={timesheetsQuery.searchInput}
                    onChange={(event) => timesheetsQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={`${timesheetsQuery.sortBy || 'createdAt'}:${timesheetsQuery.sortDir}`}
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(':');
                    timesheetsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                  }}
                >
                  <option value="createdAt:desc">Newest First</option>
                  <option value="createdAt:asc">Oldest First</option>
                  <option value="workHours:desc">Work Hours ↓</option>
                  <option value="workHours:asc">Work Hours ↑</option>
                  <option value="overtimeHours:desc">Overtime ↓</option>
                  <option value="overtimeHours:asc">Overtime ↑</option>
                </select>
                <button
                  onClick={() => void loadTimesheets()}
                  disabled={timesheetsLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', timesheetsLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>
            {timesheetsError ? <p className="text-xs text-destructive">{timesheetsError}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['ID', 'Period', 'User', 'Outlet', 'Work Hours', 'Overtime', 'Late Count', 'Absent Days'].map((header) => (
                      <th key={header} className={cn('text-[11px] px-4 py-2.5', ['Work Hours', 'Overtime', 'Late Count', 'Absent Days'].includes(header) ? 'text-right' : 'text-left')}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timesheetsLoading && timesheets.length === 0 ? (
                    <ListTableSkeleton columns={8} rows={6} />
                  ) : timesheets.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No timesheets found</td></tr>
                  ) : timesheets.map((timesheet) => (
                    <tr key={String(timesheet.id)} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-xs font-mono">{String(timesheet.id)}</td>
                      <td className="px-4 py-2.5 text-xs">{String(timesheet.payrollPeriodName || timesheet.payrollPeriodId || '—')}</td>
                      <td className="px-4 py-2.5 text-xs">{String(timesheet.userId || '—')}</td>
                      <td className="px-4 py-2.5 text-xs">{String(timesheet.outletId || '—')}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.workHours).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.overtimeHours).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.lateCount)}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono">{toNumber(timesheet.absentDays).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListPaginationControls
              total={timesheetsTotal}
              limit={timesheetsQuery.limit}
              offset={timesheetsQuery.offset}
              hasMore={timesheetsHasMore}
              disabled={timesheetsLoading}
              onPageChange={timesheetsQuery.setPage}
              onLimitChange={timesheetsQuery.setPageSize}
            />
          </div>
        ) : null}

        {activeTab === 'runs' ? (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Payroll Runs ({runsTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search payroll runs"
                    value={runsQuery.searchInput}
                    onChange={(event) => runsQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={runsQuery.filters.status || 'all'}
                  onChange={(event) => runsQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                </select>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={`${runsQuery.sortBy || 'createdAt'}:${runsQuery.sortDir}`}
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(':');
                    runsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                  }}
                >
                  <option value="createdAt:desc">Newest First</option>
                  <option value="createdAt:asc">Oldest First</option>
                  <option value="approvedAt:desc">Approved ↓</option>
                  <option value="approvedAt:asc">Approved ↑</option>
                  <option value="netSalary:desc">Net Salary ↓</option>
                  <option value="netSalary:asc">Net Salary ↑</option>
                </select>
                <button
                  onClick={() => void loadRuns()}
                  disabled={runsLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', runsLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>
            {runsError ? <p className="text-xs text-destructive">{runsError}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Run', 'Period', 'User', 'Outlet', 'Status', 'Net Salary', 'Action'].map((header) => (
                      <th key={header} className={cn('text-[11px] px-4 py-2.5', header === 'Net Salary' ? 'text-right' : 'text-left')}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runsLoading && runs.length === 0 ? (
                    <ListTableSkeleton columns={7} rows={6} />
                  ) : runs.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No payroll runs found</td></tr>
                  ) : runs.map((run) => {
                    const id = String(run.id);
                    const status = String(run.status || 'draft').toLowerCase();
                    return (
                      <tr key={id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{id}</td>
                        <td className="px-4 py-2.5 text-xs">{String(run.payrollPeriodName || run.payrollPeriodId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(run.userId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(run.outletId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(run.status || '—')}</td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono">
                          {formatCurrency(run.netSalary, String(run.currencyCode || 'USD'))}
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => void approveRun(id)}
                            disabled={status === 'approved' || actionBusy === `approve:${id}`}
                            className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                          >
                            {actionBusy === `approve:${id}` ? 'Approving...' : 'Approve'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPaginationControls
              total={runsTotal}
              limit={runsQuery.limit}
              offset={runsQuery.offset}
              hasMore={runsHasMore}
              disabled={runsLoading}
              onPageChange={runsQuery.setPage}
              onLimitChange={runsQuery.setPageSize}
            />
          </div>
        ) : null}

        {activeTab === 'config' ? (
          <EmptyState
            title="Finance configuration APIs are limited"
            description="Chart-of-accounts, tax setup, and period policy endpoints are not fully exposed in the current backend contract."
          />
        ) : null}

        {(expensesLoading || timesheetsLoading || runsLoading) && activeTab !== 'config' ? (
          <div className="hidden">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
