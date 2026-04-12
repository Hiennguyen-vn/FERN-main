import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DollarSign,
  FileText,
  RefreshCw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  financeApi,
  orgApi,
  type CreateExpensePayload,
  type ExpenseView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import {
  FINANCE_CREATE_EXPENSE_OPTIONS,
  FINANCE_EXPENSE_FILTER_OPTIONS,
  FINANCE_TAB_ITEMS,
  type FinanceTab,
} from '@/components/finance/finance-workspace-config';
import { FinancePayrollReviewWorkspace } from '@/components/finance/FinancePayrollReviewWorkspace';
import {
  formatFinanceExpenseTypeLabel,
  getFinanceOutletDisplay,
} from '@/components/finance/finance-display';
import { resolveScopeCurrencyCode } from '@/lib/org-currency';

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

const TAB_ICONS: Record<FinanceTab, React.ElementType> = {
  expenses: DollarSign,
  review: FileText,
};

type FinanceCreateExpenseSource = (typeof FINANCE_CREATE_EXPENSE_OPTIONS)[number]['value'];

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
  const [actionBusy, setActionBusy] = useState('');
  const [expenseForm, setExpenseForm] = useState({
    sourceType: 'operating_expense' as FinanceCreateExpenseSource,
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

  const patchExpensesFilters = expensesQuery.patchFilters;
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
  const outletsById = useMemo(
    () => new Map(outlets.map((outlet) => [outlet.id, outlet])),
    [outlets],
  );

  const loadExpenses = useCallback(async () => {
    if (!token) {
      return;
    }
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

  useEffect(() => {
    if (!token) {
      return;
    }
    let active = true;
    void orgApi.hierarchy(token)
      .then((hierarchy) => {
        if (!active) {
          return;
        }
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
  }, [outletId, patchExpensesFilters]);

  useEffect(() => {
    setExpenseForm((current) =>
      current.currencyCode === expenseCurrencyCode
        ? current
        : { ...current, currencyCode: expenseCurrencyCode },
    );
  }, [expenseCurrencyCode]);

  useEffect(() => {
    if (activeTab !== 'expenses') {
      return;
    }
    void loadExpenses();
  }, [activeTab, loadExpenses]);

  const createExpense = async () => {
    if (!token) {
      return;
    }
    if (!outletId) {
      toast.error('Select an outlet scope before creating an expense');
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

      if (expenseForm.sourceType === 'operating_expense') {
        await financeApi.createOperatingExpense(token, payload);
      } else {
        await financeApi.createOtherExpense(token, payload);
      }

      toast.success('Expense created');
      setExpenseForm((current) => ({
        ...current,
        amount: '',
        description: '',
      }));
      await loadExpenses();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create expense'));
    } finally {
      setActionBusy('');
    }
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Finance" />;
  }

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <div className="flex flex-shrink-0 items-center gap-0 border-b bg-card px-6">
        {FINANCE_TAB_ITEMS.map((tab) => {
          const Icon = TAB_ICONS[tab.key];
          return (
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
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'expenses' ? (
          <div className="space-y-4">
            <div className="surface-elevated p-5">
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">Expense ledger</h3>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  Finance owns the ledger. Create operating or other expenses only when you are scoped to an outlet, and review all ledger rows directly from backend truth.
                </p>
              </div>
            </div>

            <div className="surface-elevated p-4 grid grid-cols-1 gap-3 md:grid-cols-6">
              <div>
                <label className="text-xs text-muted-foreground">Expense type</label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={expenseForm.sourceType}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      sourceType: event.target.value as FinanceCreateExpenseSource,
                    }))
                  }
                >
                  {FINANCE_CREATE_EXPENSE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Business date</label>
                <input
                  type="date"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={expenseForm.businessDate}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      businessDate: event.target.value,
                    }))
                  }
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
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Description</label>
                <div className="mt-1 flex gap-2">
                  <input
                    className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    value={expenseForm.description}
                    onChange={(event) =>
                      setExpenseForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Expense description"
                  />
                  <button
                    onClick={() => void createExpense()}
                    disabled={actionBusy === 'create-expense'}
                    className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {actionBusy === 'create-expense' ? 'Saving…' : 'Create'}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Create is available only when the current shell scope includes an outlet.
                </p>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Ledger rows ({expensesTotal})</h3>
                  <p className="text-xs text-muted-foreground">
                    Results come directly from the finance-service expense ledger for the current query and scope.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
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
                    onChange={(event) =>
                      expensesQuery.setFilter(
                        'sourceType',
                        event.target.value === 'all' ? undefined : event.target.value,
                      )
                    }
                  >
                    {FINANCE_EXPENSE_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
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
                    className="flex h-8 items-center gap-1 rounded border px-2.5 text-[11px] hover:bg-accent disabled:opacity-60"
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
                        <th
                          key={header}
                          className={cn(
                            'px-4 py-2.5 text-[11px]',
                            header === 'Amount' ? 'text-right' : 'text-left',
                          )}
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expensesLoading && expenses.length === 0 ? (
                      <ListTableSkeleton columns={6} rows={6} />
                    ) : expenses.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          No expenses found
                        </td>
                      </tr>
                    ) : (
                      expenses.map((expense) => (
                        <tr key={String(expense.id)} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-xs font-mono">{String(expense.id)}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {String(expense.businessDate || '—')}
                          </td>
                          <td className="px-4 py-2.5">
                            {(() => {
                              const outletDisplay = getFinanceOutletDisplay(outletsById, expense.outletId);
                              return (
                                <div className="flex flex-col">
                                  <span className="text-xs font-medium">{outletDisplay.primary}</span>
                                  {outletDisplay.secondary ? (
                                    <span className="text-[11px] font-mono text-muted-foreground">
                                      {outletDisplay.secondary}
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {formatFinanceExpenseTypeLabel(expense.subtype, expense.sourceType)}
                          </td>
                          <td className="px-4 py-2.5 text-sm">{String(expense.description || '—')}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">
                            {formatCurrency(expense.amount, String(expense.currencyCode || 'USD'))}
                          </td>
                        </tr>
                      ))
                    )}
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
        ) : (
          <FinancePayrollReviewWorkspace
            token={token}
            scopeRegionId={regionId || undefined}
            scopeOutletId={outletId || undefined}
            regions={regions}
            outlets={outlets}
          />
        )}
      </div>
    </div>
  );
}
