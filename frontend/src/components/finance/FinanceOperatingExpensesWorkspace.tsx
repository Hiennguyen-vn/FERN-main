import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Eye, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  financeApi,
  orgApi,
  type CreateExpensePayload,
  type ExpenseDetailView,
  type ExpenseDocumentView,
  type ExpenseSummaryRow,
  type ExpenseView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import {
  FINANCE_CREATE_EXPENSE_OPTIONS,
  FINANCE_EXPENSE_FILTER_OPTIONS,
  type FinanceCreateExpenseSource,
} from '@/components/finance/finance-workspace-config';
import {
  formatFinanceExpenseTypeLabel,
  getFinanceOutletDisplay,
} from '@/components/finance/finance-display';
import { resolveScopeCurrencyCode } from '@/lib/org-currency';
import {
  toNum,
  formatMoneyExact,
  formatDateShort,
  formatDateTime,
  getExpenseSourceBadge,
} from '@/components/finance/finance-utils';
import { buildExpenseSummaryTotals } from '@/components/finance/finance-expense-summary';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}

function buildFinanceExpensesSearch(search: string) {
  const params = new URLSearchParams(search);
  params.set('tab', 'expenses');
  const text = params.toString();
  return text ? `?${text}` : '?tab=expenses';
}

export function FinanceExpenseDetailPage() {
  const { token } = useShellRuntime();
  const { expenseId = '' } = useParams<{ expenseId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [detail, setDetail] = useState<ExpenseDetailView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void orgApi.hierarchy(token)
      .then((hierarchy) => {
        if (!active) return;
        setOutlets(hierarchy.outlets || []);
      })
      .catch((err: unknown) => {
        console.error('Finance expense detail org load failed', err);
      });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!token || !expenseId) return;
    let active = true;
    setLoading(true);
    setError('');
    void financeApi.expenseDetail(token, expenseId)
      .then((nextDetail) => {
        if (!active) return;
        setDetail(nextDetail);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setDetail(null);
        setError(getErrorMessage(err, 'Unable to load expense detail'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [expenseId, token]);

  const outletsById = useMemo(
    () => new Map<string, ScopeOutlet>(outlets.map((outlet) => [outlet.id, outlet])),
    [outlets],
  );

  const backToLedger = useCallback(() => {
    navigate(`/finance${buildFinanceExpensesSearch(location.search)}`);
  }, [location.search, navigate]);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-6 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <button
            type="button"
            onClick={backToLedger}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to ledger
          </button>
          <div className="mt-4">
            <h2 className="text-xl font-semibold">Operating expense detail</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Full source document view for supplier invoice, goods receipt, and manual expense rows.
            </p>
          </div>
        </div>
        {expenseId && (
          <span className="rounded-full border bg-muted/40 px-3 py-1 font-mono text-xs text-muted-foreground">
            Expense #{expenseId}
          </span>
        )}
      </div>

      <ExpenseDetailPanel
        detail={detail}
        loading={loading}
        error={error}
        outletsById={outletsById}
      />
    </div>
  );
}


export function FinanceOperatingExpensesWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [summaryRows, setSummaryRows] = useState<ExpenseSummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [periodKey, setPeriodKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [expenseForm, setExpenseForm] = useState({
    sourceType: 'operating_expense' as FinanceCreateExpenseSource,
    amount: '',
    currencyCode: 'USD',
    description: '',
    businessDate: new Date().toISOString().slice(0, 10),
    selectedOutletId: '',
  });

  const query = useListQueryState<{ outletId?: string; sourceType?: string }>({
    initialLimit: 20,
    initialSortBy: 'businessDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: scopeOutletId || undefined, sourceType: undefined },
  });

  const outletsById = useMemo(
    () => new Map<string, ScopeOutlet>(outlets.map((o) => [o.id, o])),
    [outlets],
  );

  const currencyCode = useMemo(
    () =>
      resolveScopeCurrencyCode({
        regions,
        outlets,
        regionId: scopeRegionId || '',
        outletId: scopeOutletId || expenseForm.selectedOutletId || '',
      }),
    [outlets, regions, scopeOutletId, scopeRegionId, expenseForm.selectedOutletId],
  );

  const currencyContext = useMemo(() => {
    const effectiveOutletId = scopeOutletId || expenseForm.selectedOutletId;
    if (effectiveOutletId) {
      const outlet = outlets.find((o) => o.id === effectiveOutletId);
      return outlet ? (outlet.name || outlet.code || 'selected outlet') : 'selected outlet';
    }
    if (scopeRegionId) {
      return regions.find((r) => r.id === scopeRegionId)?.name || 'selected region';
    }
    return 'current scope';
  }, [outlets, regions, scopeOutletId, scopeRegionId, expenseForm.selectedOutletId]);

  useEffect(() => {
    setExpenseForm((f) => (f.currencyCode === currencyCode ? f : { ...f, currencyCode }));
  }, [currencyCode]);

  useEffect(() => {
    query.patchFilters({ outletId: scopeOutletId || undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeOutletId]);

  const periodRange = useMemo(() => {
    if (!periodKey) return { startDate: undefined, endDate: undefined };
    const [y, m] = periodKey.split('-').map(Number);
    const start = new Date(Date.UTC(y, (m || 1) - 1, 1));
    const end = new Date(Date.UTC(y, (m || 1), 0));
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    return { startDate: toISO(start), endDate: toISO(end) };
  }, [periodKey]);

  const periodOptions = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string }[] = [];
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
      months.push({ key, label });
    }
    return months;
  }, []);

  const activePeriodLabel = useMemo(
    () => periodOptions.find((option) => option.key === periodKey)?.label || periodKey,
    [periodKey, periodOptions],
  );

  const activeSourceLabel = useMemo(
    () =>
      FINANCE_EXPENSE_FILTER_OPTIONS.find((option) => option.value === (query.filters.sourceType || 'all'))?.label
      || 'All types',
    [query.filters.sourceType],
  );

  const activeScopeLabel = useMemo(() => {
    if (scopeOutletId) {
      const outlet = outletsById.get(scopeOutletId);
      if (!outlet) return 'Selected outlet';
      const name = outlet.name || outlet.code || 'Selected outlet';
      return outlet.code && outlet.code !== name ? `${name} · ${outlet.code}` : name;
    }
    if (scopeRegionId) {
      return regions.find((region) => region.id === scopeRegionId)?.name || 'Selected region';
    }
    return 'All outlets';
  }, [outletsById, regions, scopeOutletId, scopeRegionId]);

  const loadExpenses = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const page = await financeApi.expenses(token, {
        ...query.query,
        outletId: scopeOutletId || undefined,
        sourceType: query.filters.sourceType,
        startDate: periodRange.startDate,
        endDate: periodRange.endDate,
      });
      setExpenses(page.items || []);
      setTotal(page.total || page.totalCount || 0);
      setHasMore(page.hasMore || page.hasNextPage || false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load expenses'));
      setExpenses([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [token, query.query, query.filters.sourceType, scopeOutletId, periodRange]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const loadExpenseSummary = useCallback(async () => {
    if (!token) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const rows = await financeApi.expenseSummary(token, {
        outletId: scopeOutletId || undefined,
        sourceType: query.filters.sourceType,
        q: query.debouncedSearch || undefined,
        startDate: periodRange.startDate,
        endDate: periodRange.endDate,
      });
      setSummaryRows(rows);
    } catch (err: unknown) {
      setSummaryRows([]);
      setSummaryError(getErrorMessage(err, 'Unable to load expense totals'));
    } finally {
      setSummaryLoading(false);
    }
  }, [token, scopeOutletId, query.filters.sourceType, query.debouncedSearch, periodRange]);

  useEffect(() => {
    void loadExpenseSummary();
  }, [loadExpenseSummary]);

  const createExpense = async () => {
    if (!token) return;
    const effectiveOutletId = scopeOutletId || expenseForm.selectedOutletId;
    if (!effectiveOutletId) {
      toast.error('Select an outlet before creating an expense');
      return;
    }
    if (!expenseForm.businessDate) {
      toast.error('Business date is required');
      return;
    }
    if (!expenseForm.description.trim() || toNum(expenseForm.amount) <= 0) {
      toast.error('Description and a positive amount are required');
      return;
    }

    setActionBusy('create');
    try {
      const payload: CreateExpensePayload = {
        outletId: effectiveOutletId,
        businessDate: expenseForm.businessDate,
        currencyCode: expenseForm.currencyCode,
        amount: toNum(expenseForm.amount),
        description: expenseForm.description.trim(),
        note: null,
      };

      if (expenseForm.sourceType === 'operating_expense') {
        await financeApi.createOperatingExpense(token, payload);
      } else {
        await financeApi.createOtherExpense(token, payload);
      }

      toast.success('Expense created');
      setExpenseForm((f) => ({ ...f, amount: '', description: '' }));
      setShowCreate(false);
      await Promise.all([loadExpenses(), loadExpenseSummary()]);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to create expense');
      toast.error(
        message.includes('FISCAL_PERIOD_CLOSED')
          ? 'This finance period is closed. Choose an open business date or reopen the period first.'
          : message,
      );
    } finally {
      setActionBusy('');
    }
  };

  const openExpenseDetail = useCallback((expenseId: string) => {
    if (!expenseId) return;
    navigate(`/finance/expenses/${encodeURIComponent(expenseId)}${buildFinanceExpensesSearch(location.search)}`);
  }, [location.search, navigate]);

  const summary = useMemo(() => buildExpenseSummaryTotals(summaryRows), [summaryRows]);
  const summaryUnavailable = Boolean(summaryError) && !summaryLoading;
  const showOutletColumn = !scopeOutletId;
  const tableColumnCount = showOutletColumn ? 7 : 6;
  const sourceBreakdown = useMemo(() => {
    const rows = [
      {
        key: 'manual',
        label: 'Manual',
        amount: summary.manual,
        count: summary.manualCount,
        dotClassName: 'bg-blue-500',
        barClassName: 'bg-blue-500',
      },
      {
        key: 'invoice',
        label: 'Invoices',
        amount: summary.invoice,
        count: summary.invoiceCount,
        dotClassName: 'bg-orange-500',
        barClassName: 'bg-orange-500',
      },
      {
        key: 'payroll',
        label: 'Payroll',
        amount: summary.payroll,
        count: summary.payrollCount,
        dotClassName: 'bg-purple-500',
        barClassName: 'bg-purple-500',
      },
    ];

    if (summary.system || summary.systemCount) {
      rows.push({
        key: 'system',
        label: 'System',
        amount: summary.system,
        count: summary.systemCount,
        dotClassName: 'bg-muted-foreground',
        barClassName: 'bg-muted-foreground',
      });
    }

    return rows;
  }, [summary]);
  const refreshLedger = useCallback(async () => {
    await Promise.all([loadExpenses(), loadExpenseSummary()]);
  }, [loadExpenses, loadExpenseSummary]);

  return (
    <div className="space-y-4 animate-fade-in">
      <section className="surface-elevated overflow-hidden">
        <div className="border-b px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">Operating expense ledger</h3>
                <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {activeScopeLabel}
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Review manual costs, supplier invoices, and payroll postings for the selected finance period.
                Totals include every matching entry across all ledger pages.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                onClick={() => void refreshLedger()}
                disabled={loading || summaryLoading}
                className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-accent disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', (loading || summaryLoading) && 'animate-spin')} />
                Refresh
              </button>
              <button
                onClick={() => setShowCreate((v) => !v)}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                New Expense
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-0 xl:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.8fr)]">
          <div className="border-b px-5 py-4 xl:border-b-0 xl:border-r">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {activePeriodLabel}
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-normal">
              {summaryUnavailable ? '—' : formatMoneyExact(summary.total, currencyCode)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summaryLoading
                ? 'Updating period total…'
                : summaryUnavailable
                  ? 'Period total unavailable'
                  : `${summary.totalCount.toLocaleString()} matching row${summary.totalCount === 1 ? '' : 's'}`}
            </p>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Filter: {activeSourceLabel.toLowerCase()}
              {query.debouncedSearch ? ` · Search "${query.debouncedSearch}"` : ''}
            </p>
            {summaryError && (
              <p className="mt-2 text-[11px] text-destructive">{summaryError}</p>
            )}
          </div>

          <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {sourceBreakdown.map((item) => (
              <SourceBreakdownMetric
                key={item.key}
                label={item.label}
                amount={item.amount}
                count={item.count}
                total={summary.total}
                currency={currencyCode}
                dotClassName={item.dotClassName}
                barClassName={item.barClassName}
                loading={summaryLoading}
                unavailable={summaryUnavailable}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Create form */}
      {showCreate && (
        <section className="surface-elevated p-5">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold">Manual expense entry</h4>
              <p className="text-xs text-muted-foreground">
                Use this for outlet costs that do not come from supplier invoices or payroll runs.
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">Currency follows {currencyContext}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {!scopeOutletId && (
              <div>
                <label htmlFor="finance-expense-outlet" className="text-xs text-muted-foreground">Outlet</label>
                <select
                  id="finance-expense-outlet"
                  aria-label="Outlet"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={expenseForm.selectedOutletId}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setExpenseForm((f) => ({ ...f, selectedOutletId: value }));
                  }}
                >
                  <option value="">Select outlet…</option>
                  {outlets
                    .filter((o) => !scopeRegionId || o.regionId === scopeRegionId)
                    .map((o) => (
                      <option key={o.id} value={o.id}>{o.code || o.name || o.id}</option>
                    ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="finance-expense-type" className="text-xs text-muted-foreground">Expense type</label>
              <select
                id="finance-expense-type"
                aria-label="Expense type"
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={expenseForm.sourceType}
                onChange={(e) => {
                  const value = e.currentTarget.value as FinanceCreateExpenseSource;
                  setExpenseForm((f) => ({ ...f, sourceType: value }));
                }}
              >
                {FINANCE_CREATE_EXPENSE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="finance-expense-business-date" className="text-xs text-muted-foreground">Business date</label>
              <input
                id="finance-expense-business-date"
                aria-label="Business date"
                type="date"
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={expenseForm.businessDate}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  setExpenseForm((f) => ({ ...f, businessDate: value }));
                }}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setExpenseForm((f) => ({ ...f, businessDate: value }));
                }}
              />
            </div>
            <div>
              <label htmlFor="finance-expense-currency" className="text-xs text-muted-foreground">Currency</label>
              <input
                id="finance-expense-currency"
                readOnly
                aria-readonly="true"
                title={`Auto-set from ${currencyContext}`}
                className="mt-1 h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm"
                value={expenseForm.currencyCode}
              />
            </div>
            <div>
              <label htmlFor="finance-expense-amount" className="text-xs text-muted-foreground">Amount</label>
              <input
                id="finance-expense-amount"
                aria-label="Amount"
                type="number"
                min="0"
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={expenseForm.amount}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setExpenseForm((f) => ({ ...f, amount: value }));
                }}
              />
            </div>
            <div className="sm:col-span-2 xl:col-span-2">
              <label htmlFor="finance-expense-description" className="text-xs text-muted-foreground">Description</label>
              <div className="mt-1 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
                <input
                  id="finance-expense-description"
                  aria-label="Description"
                  className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Expense description"
                  value={expenseForm.description}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setExpenseForm((f) => ({ ...f, description: value }));
                  }}
                />
                <button
                  onClick={() => void createExpense()}
                  disabled={actionBusy === 'create'}
                  className="h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-60"
                >
                  {actionBusy === 'create' ? 'Saving…' : 'Create'}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="h-9 rounded-md border px-3 text-xs hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Ledger table */}
      <div className="surface-elevated overflow-hidden">
        <div className="border-b px-5 py-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Ledger rows ({total})</h3>
              <p className="text-xs text-muted-foreground">
                Invoice and payroll rows are locked; manual rows are user-entered operating costs.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {activePeriodLabel} · {activeSourceLabel}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_160px_130px]">
            <label className="min-w-0 text-[11px] font-medium text-muted-foreground">
              Search
              <span className="relative mt-1 block">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground"
                  placeholder={showOutletColumn ? 'Description or outlet' : 'Description'}
                  value={query.searchInput}
                  onChange={(e) => query.setSearchInput(e.target.value)}
                />
              </span>
            </label>
            <label className="text-[11px] font-medium text-muted-foreground">
              Period
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
              >
                {periodOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-medium text-muted-foreground">
              Source
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={query.filters.sourceType || 'all'}
                onChange={(e) =>
                  query.setFilter('sourceType', e.target.value === 'all' ? undefined : e.target.value)
                }
              >
                {FINANCE_EXPENSE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-medium text-muted-foreground">
              Sort
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={`${query.sortBy || 'businessDate'}:${query.sortDir}`}
                onChange={(e) => {
                  const [field, dir] = e.target.value.split(':');
                  query.applySort(field, dir === 'asc' ? 'asc' : 'desc');
                }}
              >
                <option value="businessDate:desc">Date ↓</option>
                <option value="businessDate:asc">Date ↑</option>
                <option value="amount:desc">Amount ↓</option>
                <option value="amount:asc">Amount ↑</option>
              </select>
            </label>
          </div>
        </div>

        {error && (
          <p className="border-b px-5 py-3 text-xs text-destructive">{error}</p>
        )}

        <div className="overflow-x-auto">
          <table className={cn('w-full table-fixed', showOutletColumn ? 'min-w-[1020px]' : 'min-w-[720px]')}>
            <colgroup>
              <col className="w-[108px]" />
              {showOutletColumn && <col className="w-[190px]" />}
              <col className="w-[128px]" />
              <col />
              <col className="w-[120px]" />
              <col className="w-[156px]" />
              <col className="w-[92px]" />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/30">
                {[
                  'Date',
                  ...(showOutletColumn ? ['Outlet'] : []),
                  'Type',
                  'Description',
                  'Source',
                  'Amount',
                  'Detail',
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      'px-4 py-2.5 text-[11px] font-medium',
                      h === 'Amount' || h === 'Detail' ? 'text-right' : 'text-left',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && expenses.length === 0 ? (
                <ListTableSkeleton columns={tableColumnCount} rows={8} />
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={tableColumnCount} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No expenses found for current filters
                  </td>
                </tr>
              ) : (
                expenses.map((exp) => {
                  const outletDisplay = getFinanceOutletDisplay(outletsById, exp.outletId);
                  const src = getExpenseSourceBadge(exp.sourceType, exp.subtype);
                  const expenseId = String(exp.id);
                  return (
                    <tr
                      key={expenseId}
                      className="border-b last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {String(exp.businessDate || '—')}
                      </td>
                      {showOutletColumn && (
                        <td className="px-4 py-2.5">
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-xs font-medium">{outletDisplay.primary}</span>
                            {outletDisplay.secondary && (
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {outletDisplay.secondary}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {formatFinanceExpenseTypeLabel(exp.subtype, exp.sourceType)}
                      </td>
                      <td className="px-4 py-2.5 text-sm">
                        <div className="truncate" title={String(exp.description || '')}>
                          {String(exp.description || '—')}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium',
                              src.className,
                            )}
                          >
                            {src.label}
                          </span>
                          {!src.editable && (
                            <span className="text-[10px] text-muted-foreground">locked</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-mono whitespace-nowrap">
                        {formatMoneyExact(exp.amount, String(exp.currencyCode || 'USD'))}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => openExpenseDetail(expenseId)}
                          className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium hover:bg-accent"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t px-4 py-3">
          <ListPaginationControls
            total={total}
            limit={query.limit}
            offset={query.offset}
            hasMore={hasMore}
            disabled={loading}
            onPageChange={query.setPage}
            onLimitChange={query.setPageSize}
          />
        </div>
      </div>

      {/* Source legend */}
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Manual — created by user
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-orange-500" />
          Invoice — from approved invoice
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-purple-500" />
          Payroll — from approved payroll run
        </span>
      </div>
    </div>
  );
}

function ExpenseDetailPanel({
  detail,
  loading,
  error,
  outletsById,
  onClose,
}: {
  detail: ExpenseDetailView | null;
  loading: boolean;
  error: string;
  outletsById: Map<string, ScopeOutlet>;
  onClose?: () => void;
}) {
  const expense = detail?.expense;
  const supplierInvoices = detail?.supplierInvoices?.length
    ? detail.supplierInvoices
    : detail?.supplierInvoice
      ? [detail.supplierInvoice]
      : [];
  const inventoryReceipt = detail?.inventoryReceipt;
  const source = expense ? getExpenseSourceBadge(expense.sourceType, expense.subtype) : null;
  const outletDisplay = expense ? getFinanceOutletDisplay(outletsById, expense.outletId) : null;

  return (
    <section className="surface-elevated overflow-hidden">
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Expense detail</h3>
            {expense && (
              <span className="rounded-full border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                #{expense.id}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {supplierInvoices.length
              ? 'Review the supplier invoices, receipt, purchase order, and invoice lines behind this expense.'
              : inventoryReceipt
                ? 'Review the goods receipt, purchase order, supplier, and received item lines behind this expense.'
              : 'Review the ledger source, accounting date, outlet, and audit timestamps.'}
          </p>
        </div>
        {onClose && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-accent"
              aria-label="Close expense detail"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 px-5 py-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : error ? (
        <p className="px-5 py-4 text-sm text-destructive">{error}</p>
      ) : expense ? (
        <>
          <div className="grid gap-0 border-b md:grid-cols-3">
            <DetailField label="Business date" value={String(expense.businessDate || '—')} />
            <DetailField
              label="Amount"
              value={formatMoneyExact(expense.amount, String(expense.currencyCode || 'USD'))}
              valueClassName="font-mono text-base font-semibold"
            />
            <DetailField
              label="Source"
              value={
                <span className="flex items-center gap-1.5">
                  {source && (
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', source.className)}>
                      {source.label}
                    </span>
                  )}
                  {source && !source.editable && <span className="text-[11px] text-muted-foreground">locked</span>}
                </span>
              }
            />
            <DetailField
              label="Outlet"
              value={
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{outletDisplay?.primary || '—'}</span>
                  {outletDisplay?.secondary && (
                    <span className="truncate font-mono text-[11px] text-muted-foreground">{outletDisplay.secondary}</span>
                  )}
                </span>
              }
            />
            <DetailField label="Created" value={formatDateTime(expense.createdAt)} />
            <DetailField label="Updated" value={formatDateTime(expense.updatedAt)} />
          </div>

          {supplierInvoices.length > 0 && (
            <div className="border-b bg-muted/10">
              <div className="border-b px-5 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Supplier invoices
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {supplierInvoices.length} supplier invoice{supplierInvoices.length === 1 ? '' : 's'} linked to this expense receipt.
                </p>
              </div>
              <div className="divide-y">
                {supplierInvoices.map((invoice) => (
                  <SupplierInvoiceExpensePanel
                    key={invoice.invoiceId || invoice.invoiceNumber || invoice.goodsReceiptId || 'invoice'}
                    invoice={invoice}
                    currency={String(expense.currencyCode || 'USD')}
                  />
                ))}
              </div>
            </div>
          )}

          {supplierInvoices.length === 0 && inventoryReceipt && (
            <InventoryReceiptExpensePanel receipt={inventoryReceipt} currency={String(expense.currencyCode || 'USD')} />
          )}

          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
            <div className="border-b px-5 py-4 md:border-b-0 md:border-r">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Description</p>
              <p className="mt-2 text-sm">{String(expense.description || expense.note || '—')}</p>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Documents</p>
                <span className="text-[11px] text-muted-foreground">
                  {detail?.documents.length || 0} file{detail?.documents.length === 1 ? '' : 's'}
                </span>
              </div>
              {detail?.documents.length ? (
                <div className="mt-3 space-y-2">
                  {detail.documents.map((document) => (
                    <ExpenseDocumentRow key={String(document.id)} document={document} />
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  No document link is attached to this expense.
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function SupplierInvoiceExpensePanel({
  invoice,
  currency,
}: {
  invoice: NonNullable<ExpenseDetailView['supplierInvoice']>;
  currency: string;
}) {
  const lineCount = invoice.lines.length;
  const supplier = [
    invoice.supplierName,
    invoice.supplierCode ? `(${invoice.supplierCode})` : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="bg-muted/10">
      <div className="grid gap-0 md:grid-cols-4">
        <DetailField
          label="Supplier invoice"
          value={
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono">{invoice.invoiceNumber || `#${invoice.invoiceId}`}</span>
              <span className="mt-1 truncate text-[11px] text-muted-foreground">{invoice.status || '—'}</span>
            </span>
          }
        />
        <DetailField
          label="Supplier"
          value={
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{supplier || '—'}</span>
              {invoice.supplierId && (
                <span className="mt-1 font-mono text-[11px] text-muted-foreground">#{invoice.supplierId}</span>
              )}
            </span>
          }
        />
        <DetailField label="Invoice date" value={formatDateShort(invoice.invoiceDate)} />
        <DetailField label="Due date" value={formatDateShort(invoice.dueDate)} />
        <DetailField label="Subtotal" value={formatMoneyExact(invoice.subtotal, invoice.currencyCode || currency)} />
        <DetailField label="Tax" value={formatMoneyExact(invoice.taxAmount, invoice.currencyCode || currency)} />
        <DetailField
          label="Invoice total"
          value={formatMoneyExact(invoice.totalAmount, invoice.currencyCode || currency)}
          valueClassName="font-mono text-base font-semibold"
        />
        <DetailField
          label="Receipt / PO"
          value={
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono">GR #{invoice.goodsReceiptId || '—'} · PO #{invoice.purchaseOrderId || '—'}</span>
              <span className="mt-1 truncate text-[11px] text-muted-foreground">
                {invoice.receiptStatus || '—'} · {invoice.purchaseOrderStatus || '—'}
              </span>
            </span>
          }
        />
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Invoice lines</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lineCount} line{lineCount === 1 ? '' : 's'} from supplier invoice #{invoice.invoiceId || '—'}.
            </p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <p>Receipt time: {formatDateTime(invoice.receiptTime)}</p>
            <p>Receipt total: {formatMoneyExact(invoice.receiptTotal, invoice.currencyCode || currency)}</p>
          </div>
        </div>

        {lineCount ? (
          <div className="mt-3 overflow-x-auto rounded-md border bg-background">
            <table className="min-w-full divide-y text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Line</th>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-left font-medium">UOM</th>
                  <th className="px-3 py-2 text-right font-medium">Unit price</th>
                  <th className="px-3 py-2 text-right font-medium">Tax</th>
                  <th className="px-3 py-2 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoice.lines.map((line) => (
                  <tr key={`${line.lineNumber}-${line.goodsReceiptItemId || line.description || 'line'}`}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{line.lineNumber}</td>
                    <td className="min-w-[220px] px-3 py-2">
                      <div className="font-medium">{line.itemName || line.description || '—'}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {line.itemCode || line.lineType || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatQuantity(line.qtyInvoiced)}</td>
                    <td className="px-3 py-2 text-xs">{line.uomCode || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoneyExact(line.unitPrice, invoice.currencyCode || currency)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      <div>{formatMoneyExact(line.taxAmount, invoice.currencyCode || currency)}</div>
                      <div className="text-[11px] text-muted-foreground">{formatQuantity(line.taxPercent)}%</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-medium">
                      {formatMoneyExact(line.lineTotal, invoice.currencyCode || currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
            This invoice has no line items available.
          </p>
        )}
      </div>
    </div>
  );
}

function InventoryReceiptExpensePanel({
  receipt,
  currency,
}: {
  receipt: NonNullable<ExpenseDetailView['inventoryReceipt']>;
  currency: string;
}) {
  const lineCount = receipt.lines.length;
  const supplier = [
    receipt.supplierName,
    receipt.supplierCode ? `(${receipt.supplierCode})` : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="border-b bg-muted/10">
      <div className="grid gap-0 md:grid-cols-4">
        <DetailField
          label="Goods receipt"
          value={
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono">GR #{receipt.goodsReceiptId || '—'}</span>
              <span className="mt-1 truncate text-[11px] text-muted-foreground">{receipt.receiptStatus || '—'}</span>
            </span>
          }
        />
        <DetailField
          label="Purchase order"
          value={
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono">PO #{receipt.purchaseOrderId || '—'}</span>
              <span className="mt-1 truncate text-[11px] text-muted-foreground">{receipt.purchaseOrderStatus || '—'}</span>
            </span>
          }
        />
        <DetailField
          label="Supplier"
          value={
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{supplier || '—'}</span>
              {receipt.supplierId && (
                <span className="mt-1 font-mono text-[11px] text-muted-foreground">#{receipt.supplierId}</span>
              )}
            </span>
          }
        />
        <DetailField
          label="Receipt total"
          value={formatMoneyExact(receipt.receiptTotal, receipt.currencyCode || currency)}
          valueClassName="font-mono text-base font-semibold"
        />
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Received item lines</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lineCount} line{lineCount === 1 ? '' : 's'} received for this inventory expense.
            </p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <p>Receipt time: {formatDateTime(receipt.receiptTime)}</p>
            <p>Business date: {formatDateShort(receipt.receiptBusinessDate)}</p>
          </div>
        </div>

        {lineCount ? (
          <div className="mt-3 overflow-x-auto rounded-md border bg-background">
            <table className="min-w-full divide-y text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Received</th>
                  <th className="px-3 py-2 text-left font-medium">UOM</th>
                  <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                  <th className="px-3 py-2 text-right font-medium">Line total</th>
                  <th className="px-3 py-2 text-left font-medium">Expiry</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {receipt.lines.map((line) => (
                  <tr key={line.goodsReceiptItemId || `${line.itemCode || line.itemName}-${line.lineTotal}`}>
                    <td className="min-w-[220px] px-3 py-2">
                      <div className="font-medium">{line.itemName || '—'}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{line.itemCode || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatQuantity(line.qtyReceived)}</td>
                    <td className="px-3 py-2 text-xs">{line.uomCode || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoneyExact(line.unitCost, receipt.currencyCode || currency)}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">
                      {formatMoneyExact(line.lineTotal, receipt.currencyCode || currency)}
                    </td>
                    <td className="px-3 py-2 text-xs">{formatDateShort(line.expiryDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
            This receipt has no item lines available.
          </p>
        )}
      </div>
    </div>
  );
}

function formatQuantity(value: unknown): string {
  const numeric = toNum(value);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(numeric);
}

function DetailField({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="border-b px-5 py-4 last:border-b-0 md:border-b md:border-r md:last:border-r-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className={cn('mt-2 min-w-0 text-sm', valueClassName)}>{value}</div>
    </div>
  );
}

function ExpenseDocumentRow({ document }: { document: ExpenseDocumentView }) {
  const url = document.url ? String(document.url) : '';
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{document.fileName || `Document ${document.id}`}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {formatDateTime(document.createdAt)} · {document.contentType || 'application/pdf'}
        </p>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium hover:bg-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </a>
      )}
    </div>
  );
}

function SourceBreakdownMetric({
  label,
  amount,
  count,
  total,
  currency = 'USD',
  dotClassName,
  barClassName,
  loading,
  unavailable,
}: {
  label: string;
  amount: number;
  count: number;
  total: number;
  currency?: string;
  dotClassName: string;
  barClassName: string;
  loading?: boolean;
  unavailable?: boolean;
}) {
  const percent = total > 0 ? Math.min(100, Math.max(0, (amount / total) * 100)) : 0;

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClassName)} />
          <span className="truncate">{label}</span>
        </span>
        <span className="text-[11px] text-muted-foreground">
          {unavailable ? '—' : `${Math.round(percent)}%`}
        </span>
      </div>
      <p className="mt-2 font-mono text-lg font-semibold">
        {unavailable ? '—' : formatMoneyExact(amount, currency)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {loading
          ? 'Updating…'
          : unavailable
            ? 'Unavailable'
            : `${count.toLocaleString()} matching row${count === 1 ? '' : 's'}`}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', barClassName)}
          style={{ width: unavailable ? '0%' : `${percent}%` }}
        />
      </div>
    </div>
  );
}
