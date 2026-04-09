import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { crmApi, type CrmCustomerView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

export function CRMModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [customers, setCustomers] = useState<CrmCustomerView[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const listState = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'lastOrderAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined },
  });
  const patchListFilters = listState.patchFilters;

  const loadCustomers = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setCustomers([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const page = await crmApi.customers(token, {
        ...listState.query,
        outletId: outletId || undefined,
      });
      setCustomers(page.items || []);
      setTotal(page.total || page.totalCount || 0);
      setHasMore(page.hasMore || page.hasNextPage || false);
    } catch (loadError: unknown) {
      console.error('CRM customers load failed:', loadError);
      setCustomers([]);
      setTotal(0);
      setHasMore(false);
      setError(getErrorMessage(loadError, 'Unable to load customers'));
    } finally {
      setLoading(false);
    }
  }, [listState.query, outletId, token]);

  useEffect(() => {
    patchListFilters({ outletId: outletId || undefined });
  }, [outletId, patchListFilters]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="CRM & Loyalty" />;
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="p-6 pb-4">
        <h2 className="text-lg font-semibold text-foreground">CRM & Loyalty</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Customer reference data is loaded from the live backend CRM customer feed.
        </p>
      </div>

      <div className="px-6 pb-6">
        <div className="surface-elevated p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h3 className="text-sm font-semibold">Customers ({total})</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                  placeholder="Search customers"
                  value={listState.searchInput}
                  onChange={(event) => listState.setSearchInput(event.target.value)}
                />
              </div>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={`${listState.sortBy || 'lastOrderAt'}:${listState.sortDir}`}
                onChange={(event) => {
                  const [field, direction] = event.target.value.split(':');
                  listState.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                }}
              >
                <option value="lastOrderAt:desc">Last Order ↓</option>
                <option value="lastOrderAt:asc">Last Order ↑</option>
                <option value="orderCount:desc">Orders ↓</option>
                <option value="orderCount:asc">Orders ↑</option>
                <option value="displayName:asc">Name A-Z</option>
                <option value="displayName:desc">Name Z-A</option>
              </select>
              <button
                onClick={() => void loadCustomers()}
                disabled={loading}
                className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
                Refresh
              </button>
            </div>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          {loading && customers.length === 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Customer', 'Reference', 'Outlet', 'Orders', 'Total Spend', 'Last Order'].map((header) => (
                      <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <ListTableSkeleton columns={6} rows={6} />
                </tbody>
              </table>
            </div>
          ) : customers.length === 0 ? (
            <EmptyState
              title="No customers found"
              description="No customer-reference rows were returned for the current scope and search filter."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Customer', 'Reference', 'Outlet', 'Orders', 'Total Spend', 'Last Order'].map((header) => (
                      <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-xs">{customer.displayName || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{customer.referenceType || '—'} · {customer.id}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {customer.outletName || customer.outletCode || customer.outletId || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{customer.orderCount}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{customer.totalSpend}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(customer.lastOrderAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ListPaginationControls
            total={total}
            limit={listState.limit}
            offset={listState.offset}
            hasMore={hasMore}
            disabled={loading}
            onPageChange={listState.setPage}
            onLimitChange={listState.setPageSize}
          />
        </div>
      </div>
    </div>
  );
}
