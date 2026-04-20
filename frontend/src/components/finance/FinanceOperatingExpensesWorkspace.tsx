import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  financeApi,
  type CreateExpensePayload,
  type ExpenseView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
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
  getExpenseSourceBadge,
} from '@/components/finance/finance-utils';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}


export function FinanceOperatingExpensesWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
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

  const createExpense = async () => {
    if (!token) return;
    const effectiveOutletId = scopeOutletId || expenseForm.selectedOutletId;
    if (!effectiveOutletId) {
      toast.error('Select an outlet before creating an expense');
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
      await loadExpenses();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create expense'));
    } finally {
      setActionBusy('');
    }
  };

  // Summary stats
  const summary = useMemo(() => {
    let manual = 0, payroll = 0, invoice = 0, sys = 0;
    for (const exp of expenses) {
      const raw = String(exp.subtype || exp.sourceType || '').toLowerCase();
      const amt = toNum(exp.amount);
      if (raw === 'payroll') payroll += amt;
      else if (raw.includes('invoice') || raw === 'inventory_purchase') invoice += amt;
      else if (raw === 'operating_expense' || raw === 'operating' || raw === 'other' || raw === 'other_expense') manual += amt;
      else sys += amt;
    }
    const totalInView = manual + payroll + invoice + sys;
    return { manual, payroll, invoice, sys, totalInView };
  }, [expenses]);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="surface-elevated px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Operating Expenses</h3>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              Full expense ledger with source tracking. Manual entries require selecting an outlet.
              Invoice- and payroll-linked rows are system-generated and immutable.
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            New Expense
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label="Manual" amount={summary.manual} currency={currencyCode} color="bg-blue-100 text-blue-700" />
        <SummaryCard label="Invoice-linked" amount={summary.invoice} currency={currencyCode} color="bg-orange-100 text-orange-700" />
        <SummaryCard label="Payroll-linked" amount={summary.payroll} currency={currencyCode} color="bg-purple-100 text-purple-700" />
        <SummaryCard label="In view (page)" amount={summary.totalInView} currency={currencyCode} color="bg-muted text-foreground" />
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="surface-elevated p-5">
          <h4 className="mb-4 text-sm font-semibold">New expense</h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            {!scopeOutletId && (
              <div>
                <label className="text-xs text-muted-foreground">Outlet</label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={expenseForm.selectedOutletId}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, selectedOutletId: e.target.value }))}
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
              <label className="text-xs text-muted-foreground">Expense type</label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={expenseForm.sourceType}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, sourceType: e.target.value as FinanceCreateExpenseSource }))
                }
              >
                {FINANCE_CREATE_EXPENSE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Business date</label>
              <input
                type="date"
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={expenseForm.businessDate}
                onChange={(e) => setExpenseForm((f) => ({ ...f, businessDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Currency</label>
              <input
                readOnly
                aria-readonly="true"
                title={`Auto-set from ${currencyContext}`}
                className="mt-1 h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm"
                value={expenseForm.currencyCode}
              />
              <p className="mt-0.5 text-[11px] text-muted-foreground">From {currencyContext}</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Amount</label>
              <input
                type="number"
                min="0"
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-muted-foreground">Description</label>
              <div className="mt-1 flex gap-2">
                <input
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Expense description"
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
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
        </div>
      )}

      {/* Ledger table */}
      <div className="surface-elevated overflow-hidden">
        <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Ledger rows ({total})</h3>
            <p className="text-xs text-muted-foreground">
              Source badges show how each row was created. Invoice and payroll rows are immutable.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-8 w-56 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                placeholder="Search expenses…"
                value={query.searchInput}
                onChange={(e) => query.setSearchInput(e.target.value)}
              />
            </div>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
            >
              {periodOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={query.filters.sourceType || 'all'}
              onChange={(e) =>
                query.setFilter('sourceType', e.target.value === 'all' ? undefined : e.target.value)
              }
            >
              {FINANCE_EXPENSE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
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
            <button
              onClick={() => void loadExpenses()}
              disabled={loading}
              className="flex h-8 items-center gap-1 rounded border px-2.5 text-[11px] hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <p className="border-b px-5 py-3 text-xs text-destructive">{error}</p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Date', 'Outlet', 'Type', 'Description', 'Source', 'Amount'].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      'px-4 py-2.5 text-[11px] font-medium',
                      h === 'Amount' ? 'text-right' : 'text-left',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && expenses.length === 0 ? (
                <ListTableSkeleton columns={6} rows={8} />
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No expenses found for current filters
                  </td>
                </tr>
              ) : (
                expenses.map((exp) => {
                  const outletDisplay = getFinanceOutletDisplay(outletsById, exp.outletId);
                  const src = getExpenseSourceBadge(exp.sourceType, exp.subtype);
                  return (
                    <tr key={String(exp.id)} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {String(exp.businessDate || '—')}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium">{outletDisplay.primary}</span>
                          {outletDisplay.secondary && (
                            <span className="text-[11px] font-mono text-muted-foreground">
                              {outletDisplay.secondary}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {formatFinanceExpenseTypeLabel(exp.subtype, exp.sourceType)}
                      </td>
                      <td className="px-4 py-2.5 text-sm max-w-[220px] truncate" title={String(exp.description || '')}>
                        {String(exp.description || '—')}
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
                            <span className="text-[10px] text-muted-foreground">read-only</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-mono whitespace-nowrap">
                        {formatMoneyExact(exp.amount, String(exp.currencyCode || 'USD'))}
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

function SummaryCard({ label, amount, currency = 'USD', color }: { label: string; amount: number; currency?: string; color: string }) {
  return (
    <div className="surface-elevated px-4 py-3">
      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', color)}>
        {label}
      </span>
      <p className="mt-2 text-xl font-semibold font-mono">
        {formatMoneyExact(amount, currency)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">in current page</p>
    </div>
  );
}
