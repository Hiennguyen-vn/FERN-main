import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Package, ScrollText, ClipboardCheck, ArrowLeftRight, Trash2, Loader2, RefreshCw, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  inventoryApi,
  productApi,
  type InventoryTransactionView,
  type ItemView,
  type StockBalanceView,
  type StockCountLineView,
  type StockCountSessionView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

type InventoryTab = 'balances' | 'ledger' | 'counts' | 'adjustments' | 'waste';

const TABS: { key: InventoryTab; label: string; icon: React.ElementType }[] = [
  { key: 'balances', label: 'Stock Balances', icon: Package },
  { key: 'ledger', label: 'Ledger', icon: ScrollText },
  { key: 'counts', label: 'Stock Counts', icon: ClipboardCheck },
  { key: 'adjustments', label: 'Adjustments', icon: ArrowLeftRight },
  { key: 'waste', label: 'Waste', icon: Trash2 },
];

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function NumberCell({ value }: { value: unknown }) {
  const n = Number(value ?? 0);
  return <span className="font-mono">{Number.isFinite(n) ? n.toFixed(2) : '0.00'}</span>;
}

function formatQuantity(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
}

function sessionShortLabel(sessionId: string) {
  const normalized = String(sessionId ?? '').trim();
  if (!normalized) return 'Session';
  return normalized.length > 8 ? `#${normalized.slice(-8)}` : `#${normalized}`;
}

function statusBadgeClass(status: string) {
  switch (status.toLowerCase()) {
    case 'posted':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'draft':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatWasteTxnType(value: string | null | undefined) {
  if (!value) return 'Waste';
  if (value === 'waste_out') return 'Waste';
  return value.replace(/_/g, ' ');
}

function summarizeCountSession(
  session: StockCountSessionView,
  itemNameById: Map<string, string>,
) {
  const lines = Array.isArray(session.lines) ? session.lines : [];
  if (lines.length > 0) {
    const firstLine = lines[0];
    const itemId = String(firstLine.itemId ?? '');
    const itemName = itemNameById.get(itemId) || `Item ${itemId || 'unknown'}`;
    const extraCount = lines.length > 1 ? ` +${lines.length - 1} more` : '';
    return {
      title: `${itemName}${extraCount}`,
      meta: `Actual ${formatQuantity(firstLine.actualQty)} vs system ${formatQuantity(firstLine.systemQty)} · variance ${formatQuantity(firstLine.varianceQty)}`,
    };
  }

  const countedItems = Number(session.countedItems ?? session.totalItems ?? 0);
  const totalItems = Number(session.totalItems ?? countedItems ?? 0);
  const varianceItems = Number(session.varianceItems ?? 0);
  return {
    title: totalItems > 0 ? `${countedItems}/${totalItems} items counted` : 'Open session',
    meta: varianceItems > 0 ? `${varianceItems} items with variance` : (session.note || 'Review session before posting'),
  };
}

export function InventoryModule() {
  const { token, scope } = useShellRuntime();
  const [activeTab, setActiveTab] = useState<InventoryTab>('balances');
  const [itemsLoading, setItemsLoading] = useState(true);
  const [items, setItems] = useState<ItemView[]>([]);

  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState('');
  const [balances, setBalances] = useState<StockBalanceView[]>([]);
  const [balancesTotal, setBalancesTotal] = useState(0);
  const [balancesHasMore, setBalancesHasMore] = useState(false);

  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState('');
  const [transactions, setTransactions] = useState<InventoryTransactionView[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerHasMore, setLedgerHasMore] = useState(false);

  const [countsLoading, setCountsLoading] = useState(false);
  const [countsError, setCountsError] = useState('');
  const [counts, setCounts] = useState<StockCountSessionView[]>([]);
  const [countsTotal, setCountsTotal] = useState(0);
  const [countsHasMore, setCountsHasMore] = useState(false);
  const [countDetailsById, setCountDetailsById] = useState<Record<string, StockCountSessionView>>({});
  const [selectedCountSessionId, setSelectedCountSessionId] = useState('');
  const [countReviewLoading, setCountReviewLoading] = useState(false);
  const [wasteLoading, setWasteLoading] = useState(false);
  const [wasteError, setWasteError] = useState('');
  const [wasteRecords, setWasteRecords] = useState<InventoryTransactionView[]>([]);
  const [wasteTotal, setWasteTotal] = useState(0);
  const [wasteHasMore, setWasteHasMore] = useState(false);

  const [creatingWaste, setCreatingWaste] = useState(false);
  const [creatingCount, setCreatingCount] = useState(false);
  const [postingCountId, setPostingCountId] = useState('');
  const [wasteForm, setWasteForm] = useState({
    itemId: '',
    quantity: '0',
    reason: '',
    note: '',
    businessDate: new Date().toISOString().slice(0, 10),
  });
  const [countForm, setCountForm] = useState({
    itemId: '',
    actualQty: '0',
    note: '',
    countDate: new Date().toISOString().slice(0, 10),
  });

  const outletId = normalizeNumeric(scope.outletId);
  const itemNameById = useMemo(
    () => new Map(items.map((item) => [String(item.id), String(item.name ?? `Item ${item.id}`)])),
    [items],
  );
  const selectedCountSession = useMemo(
    () => (selectedCountSessionId ? (countDetailsById[selectedCountSessionId] || counts.find((row) => row.id === selectedCountSessionId) || null) : null),
    [countDetailsById, counts, selectedCountSessionId],
  );
  const wasteSummary = useMemo(() => {
    const totalQuantity = wasteRecords.reduce((sum, row) => sum + Math.abs(Number(row.qtyChange ?? 0)), 0);
    const latest = wasteRecords[0];
    return {
      totalQuantity,
      latestAt: latest?.txnTime || latest?.createdAt || null,
    };
  }, [wasteRecords]);

  const balancesQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'itemId',
    initialSortDir: 'asc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const ledgerQuery = useListQueryState<{ outletId?: string; txnType?: string }>({
    initialLimit: 20,
    initialSortBy: 'txnTime',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, txnType: undefined },
  });
  const countsQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'countDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const wasteQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'txnTime',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined },
  });
  const patchBalancesFilters = balancesQuery.patchFilters;
  const patchLedgerFilters = ledgerQuery.patchFilters;
  const patchCountsFilters = countsQuery.patchFilters;
  const patchWasteFilters = wasteQuery.patchFilters;

  const loadItems = useCallback(async () => {
    if (!token || !outletId) {
      setItemsLoading(false);
      setItems([]);
      return;
    }
    setItemsLoading(true);
    try {
      const nextItems = await productApi.items(token);
      setItems(Array.isArray(nextItems) ? nextItems : []);
    } catch (error) {
      console.error('Inventory item catalog load failed', error);
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, [outletId, token]);

  const loadBalances = useCallback(async () => {
    if (!token || !outletId) {
      setBalancesLoading(false);
      setBalances([]);
      setBalancesTotal(0);
      setBalancesHasMore(false);
      return;
    }
    setBalancesLoading(true);
    setBalancesError('');
    try {
      const page = await inventoryApi.balancesPage(token, {
        ...balancesQuery.query,
        outletId,
        status: balancesQuery.filters.status,
      });
      setBalances(page.items || []);
      setBalancesTotal(page.total || page.totalCount || 0);
      setBalancesHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Inventory balances load failed', error);
      setBalances([]);
      setBalancesTotal(0);
      setBalancesHasMore(false);
      setBalancesError(getErrorMessage(error, 'Unable to load stock balances'));
    } finally {
      setBalancesLoading(false);
    }
  }, [balancesQuery.filters.status, balancesQuery.query, outletId, token]);

  const loadLedger = useCallback(async () => {
    if (!token || !outletId) {
      setLedgerLoading(false);
      setTransactions([]);
      setLedgerTotal(0);
      setLedgerHasMore(false);
      return;
    }
    setLedgerLoading(true);
    setLedgerError('');
    try {
      const page = await inventoryApi.transactions(token, {
        ...ledgerQuery.query,
        outletId,
        txnType: ledgerQuery.filters.txnType,
      });
      setTransactions(page.items || []);
      setLedgerTotal(page.total || page.totalCount || 0);
      setLedgerHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Inventory ledger load failed', error);
      setTransactions([]);
      setLedgerTotal(0);
      setLedgerHasMore(false);
      setLedgerError(getErrorMessage(error, 'Unable to load inventory transactions'));
    } finally {
      setLedgerLoading(false);
    }
  }, [ledgerQuery.filters.txnType, ledgerQuery.query, outletId, token]);

  const loadCounts = useCallback(async () => {
    if (!token || !outletId) {
      setCountsLoading(false);
      setCounts([]);
      setCountsTotal(0);
      setCountsHasMore(false);
      return;
    }
    setCountsLoading(true);
    setCountsError('');
    try {
      const page = await inventoryApi.stockCountSessions(token, {
        ...countsQuery.query,
        outletId,
        status: countsQuery.filters.status,
      });
      setCounts(page.items || []);
      setCountsTotal(page.total || page.totalCount || 0);
      setCountsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Inventory count sessions load failed', error);
      setCounts([]);
      setCountsTotal(0);
      setCountsHasMore(false);
      setCountsError(getErrorMessage(error, 'Unable to load stock count sessions'));
    } finally {
      setCountsLoading(false);
    }
  }, [countsQuery.filters.status, countsQuery.query, outletId, token]);

  const loadWasteRecords = useCallback(async () => {
    if (!token || !outletId) {
      setWasteLoading(false);
      setWasteRecords([]);
      setWasteTotal(0);
      setWasteHasMore(false);
      return;
    }
    setWasteLoading(true);
    setWasteError('');
    try {
      const page = await inventoryApi.transactions(token, {
        ...wasteQuery.query,
        outletId,
        txnType: 'waste_out',
      });
      setWasteRecords(page.items || []);
      setWasteTotal(page.total || page.totalCount || 0);
      setWasteHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Waste records load failed', error);
      setWasteRecords([]);
      setWasteTotal(0);
      setWasteHasMore(false);
      setWasteError(getErrorMessage(error, 'Unable to load waste records'));
    } finally {
      setWasteLoading(false);
    }
  }, [outletId, token, wasteQuery.query]);

  useEffect(() => {
    patchBalancesFilters({ outletId: outletId || undefined });
    patchLedgerFilters({ outletId: outletId || undefined });
    patchCountsFilters({ outletId: outletId || undefined });
    patchWasteFilters({ outletId: outletId || undefined });
  }, [outletId, patchBalancesFilters, patchCountsFilters, patchLedgerFilters, patchWasteFilters]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (activeTab !== 'balances') return;
    void loadBalances();
  }, [activeTab, loadBalances]);

  useEffect(() => {
    if (activeTab !== 'ledger') return;
    void loadLedger();
  }, [activeTab, loadLedger]);

  useEffect(() => {
    if (activeTab !== 'counts') return;
    void loadCounts();
  }, [activeTab, loadCounts]);

  useEffect(() => {
    if (activeTab !== 'waste') return;
    void loadWasteRecords();
  }, [activeTab, loadWasteRecords]);

  useEffect(() => {
    if (activeTab !== 'counts' || !token || counts.length === 0) return;
    const sessionIds = counts
      .map((session) => String(session.id))
      .filter((sessionId) => !countDetailsById[sessionId]?.lines?.length);
    if (sessionIds.length === 0) return;

    let cancelled = false;
    void Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          const detail = await inventoryApi.getStockCountSession(token, sessionId);
          return [sessionId, detail] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const nextEntries = entries.filter((entry): entry is readonly [string, StockCountSessionView] => entry !== null);
      if (nextEntries.length === 0) return;
      setCountDetailsById((prev) => {
        const next = { ...prev };
        for (const [sessionId, detail] of nextEntries) {
          next[sessionId] = detail;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, countDetailsById, counts, token]);

  const createWaste = async () => {
    if (!token || !outletId) return;
    if (!wasteForm.itemId || Number(wasteForm.quantity) <= 0 || !wasteForm.reason.trim()) {
      toast.error('Item, quantity, and reason are required');
      return;
    }
    setCreatingWaste(true);
    try {
      await inventoryApi.createWaste(token, {
        outletId,
        itemId: wasteForm.itemId,
        quantity: Number(wasteForm.quantity),
        businessDate: wasteForm.businessDate,
        reason: wasteForm.reason.trim(),
        note: wasteForm.note || null,
      });
      toast.success('Waste record created');
      setWasteForm((prev) => ({ ...prev, quantity: '0', reason: '', note: '' }));
      await Promise.all([loadBalances(), loadLedger(), loadWasteRecords()]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create waste record'));
    } finally {
      setCreatingWaste(false);
    }
  };

  const createCount = async () => {
    if (!token || !outletId) return;
    if (!countForm.itemId) {
      toast.error('Please select an item to count');
      return;
    }
    setCreatingCount(true);
    try {
      await inventoryApi.createStockCountSession(token, {
        outletId,
        countDate: countForm.countDate,
        note: countForm.note || null,
        lines: [{ itemId: countForm.itemId, actualQty: Number(countForm.actualQty), note: countForm.note || null }],
      });
      toast.success('Stock count session created');
      setCountForm((prev) => ({ ...prev, actualQty: '0', note: '' }));
      await Promise.all([loadCounts(), loadBalances()]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create stock count session'));
    } finally {
      setCreatingCount(false);
    }
  };

  const postCount = async (sessionId: string) => {
    if (!token) return;
    setPostingCountId(sessionId);
    try {
      await inventoryApi.postStockCountSession(token, sessionId);
      toast.success('Stock count session posted');
      setSelectedCountSessionId('');
      await Promise.all([loadCounts(), loadBalances(), loadLedger()]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to post stock count session'));
    } finally {
      setPostingCountId('');
    }
  };

  const openCountReview = async (sessionId: string) => {
    setSelectedCountSessionId(sessionId);
    if (!token || countDetailsById[sessionId]?.lines?.length) return;
    setCountReviewLoading(true);
    try {
      const detail = await inventoryApi.getStockCountSession(token, sessionId);
      setCountDetailsById((prev) => ({ ...prev, [sessionId]: detail }));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to load stock count session details'));
    } finally {
      setCountReviewLoading(false);
    }
  };

  if (!outletId) {
    return (
      <ServiceUnavailablePage
        state="route_unavailable"
        moduleName="Inventory"
      />
    );
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

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'balances' && (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Stock Balances ({balancesTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search item or id"
                    value={balancesQuery.searchInput}
                    onChange={(event) => balancesQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={balancesQuery.filters.status || 'all'}
                  onChange={(event) => balancesQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="ok">OK</option>
                  <option value="low">Low</option>
                  <option value="out_of_stock">Out of stock</option>
                </select>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={`${balancesQuery.sortBy || 'itemId'}:${balancesQuery.sortDir}`}
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(':');
                    balancesQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                  }}
                >
                  <option value="itemId:asc">Item ↑</option>
                  <option value="itemId:desc">Item ↓</option>
                  <option value="qtyOnHand:asc">Qty ↑</option>
                  <option value="qtyOnHand:desc">Qty ↓</option>
                  <option value="lastCountDate:desc">Last Count ↓</option>
                  <option value="lastCountDate:asc">Last Count ↑</option>
                </select>
                <button
                  onClick={() => void loadBalances()}
                  disabled={balancesLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', balancesLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>

            {balancesError ? <p className="text-xs text-destructive">{balancesError}</p> : null}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">Item</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Qty On Hand</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Unit Cost</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Last Count</th>
                  </tr>
                </thead>
                <tbody>
                  {balancesLoading && balances.length === 0 ? (
                    <ListTableSkeleton columns={4} rows={7} />
                  ) : balances.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No stock balances found</td></tr>
                  ) : balances.map((row) => (
                    <tr key={`${row.outletId}-${row.itemId}`} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-sm">{itemNameById.get(String(row.itemId)) || `Item ${row.itemId}`}</td>
                      <td className="px-4 py-2.5 text-right text-sm"><NumberCell value={row.qtyOnHand} /></td>
                      <td className="px-4 py-2.5 text-right text-sm"><NumberCell value={row.unitCost} /></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.lastCountDate ? String(row.lastCountDate) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ListPaginationControls
              total={balancesTotal}
              limit={balancesQuery.limit}
              offset={balancesQuery.offset}
              hasMore={balancesHasMore}
              disabled={balancesLoading}
              onPageChange={balancesQuery.setPage}
              onLimitChange={balancesQuery.setPageSize}
            />
          </div>
        )}

        {activeTab === 'ledger' && (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Inventory Ledger ({ledgerTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search ledger"
                    value={ledgerQuery.searchInput}
                    onChange={(event) => ledgerQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={ledgerQuery.filters.txnType || 'all'}
                  onChange={(event) => ledgerQuery.setFilter('txnType', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All types</option>
                  <option value="stock_count">Stock count</option>
                  <option value="waste_out">Waste</option>
                  <option value="goods_receipt">Goods receipt</option>
                </select>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={`${ledgerQuery.sortBy || 'txnTime'}:${ledgerQuery.sortDir}`}
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(':');
                    ledgerQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                  }}
                >
                  <option value="txnTime:desc">Latest First</option>
                  <option value="txnTime:asc">Oldest First</option>
                  <option value="qtyChange:desc">Qty Change ↓</option>
                  <option value="qtyChange:asc">Qty Change ↑</option>
                </select>
                <button
                  onClick={() => void loadLedger()}
                  disabled={ledgerLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', ledgerLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>

            {ledgerError ? <p className="text-xs text-destructive">{ledgerError}</p> : null}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">Time</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Item</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Type</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Qty Change</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerLoading && transactions.length === 0 ? (
                    <ListTableSkeleton columns={5} rows={7} />
                  ) : transactions.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No inventory transactions found</td></tr>
                  ) : transactions.map((row) => (
                    <tr key={String(row.id)} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.txnTime || row.createdAt || '—'}</td>
                      <td className="px-4 py-2.5 text-sm">{itemNameById.get(String(row.itemId)) || `Item ${row.itemId}`}</td>
                      <td className="px-4 py-2.5 text-xs">{String(row.txnType || 'unknown')}</td>
                      <td className="px-4 py-2.5 text-right text-sm"><NumberCell value={row.qtyChange} /></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ListPaginationControls
              total={ledgerTotal}
              limit={ledgerQuery.limit}
              offset={ledgerQuery.offset}
              hasMore={ledgerHasMore}
              disabled={ledgerLoading}
              onPageChange={ledgerQuery.setPage}
              onLimitChange={ledgerQuery.setPageSize}
            />
          </div>
        )}

        {activeTab === 'counts' && (
          <div className="space-y-4">
            <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Item</label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={countForm.itemId}
                  onChange={(e) => setCountForm((prev) => ({ ...prev, itemId: e.target.value }))}
                >
                  <option value="">Select item</option>
                  {items.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>{String(item.name || item.code || item.id)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Actual Qty</label>
                <input
                  type="number"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={countForm.actualQty}
                  onChange={(e) => setCountForm((prev) => ({ ...prev, actualQty: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Count Date</label>
                <input
                  type="date"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={countForm.countDate}
                  onChange={(e) => setCountForm((prev) => ({ ...prev, countDate: e.target.value }))}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => void createCount()}
                  disabled={creatingCount || itemsLoading}
                  className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60"
                >
                  {creatingCount ? 'Creating...' : 'Create Count'}
                </button>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Stock Count Sessions ({countsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search count sessions"
                      value={countsQuery.searchInput}
                      onChange={(event) => countsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={countsQuery.filters.status || 'all'}
                    onChange={(event) => countsQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="posted">Posted</option>
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${countsQuery.sortBy || 'countDate'}:${countsQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      countsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="countDate:desc">Date ↓</option>
                    <option value="countDate:asc">Date ↑</option>
                    <option value="status:asc">Status A-Z</option>
                    <option value="status:desc">Status Z-A</option>
                  </select>
                  <button
                    onClick={() => void loadCounts()}
                    disabled={countsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', countsLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              {countsError ? <p className="text-xs text-destructive">{countsError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Session</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Count Summary</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Date</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                      <th className="text-right text-[11px] px-4 py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countsLoading && counts.length === 0 ? (
                      <ListTableSkeleton columns={5} rows={6} />
                    ) : counts.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No stock count sessions found</td></tr>
                    ) : counts.map((row) => (
                      <tr key={String(row.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 align-top">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold">{sessionShortLabel(String(row.id))}</span>
                            <span className="text-[11px] font-mono text-muted-foreground">{String(row.id)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          {(() => {
                            const resolvedRow = countDetailsById[String(row.id)] || row;
                            const summary = summarizeCountSession(resolvedRow, itemNameById);
                            return (
                              <div className="space-y-1">
                                <div className="text-sm font-medium">{summary.title}</div>
                                <div className="text-[11px] text-muted-foreground">{summary.meta}</div>
                                {resolvedRow.note ? (
                                  <div className="text-[11px] text-muted-foreground">Note: {resolvedRow.note}</div>
                                ) : null}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(row.countDate || '—')}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
                            statusBadgeClass(String(row.status || 'unknown')),
                          )}
                          >
                            {String(row.status || '—')}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => void openCountReview(String(row.id))}
                            disabled={countReviewLoading && selectedCountSessionId === String(row.id)}
                            className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                          >
                            {String(row.status || '').toLowerCase() === 'posted' ? 'View' : 'Review & Post'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ListPaginationControls
                total={countsTotal}
                limit={countsQuery.limit}
                offset={countsQuery.offset}
                hasMore={countsHasMore}
                disabled={countsLoading}
                onPageChange={countsQuery.setPage}
                onLimitChange={countsQuery.setPageSize}
              />
            </div>
          </div>
        )}

        {activeTab === 'adjustments' && (
          <EmptyState
            title="Stock adjustments are not exposed"
            description="The current backend contracts do not provide a dedicated stock adjustment endpoint."
          />
        )}

        {activeTab === 'waste' && (
          <div className="space-y-4">
            <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Item</label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={wasteForm.itemId}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, itemId: e.target.value }))}
                >
                  <option value="">Select item</option>
                  {items.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>{String(item.name || item.code || item.id)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Quantity</label>
                <input
                  type="number"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={wasteForm.quantity}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, quantity: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Date</label>
                <input
                  type="date"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={wasteForm.businessDate}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, businessDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Reason</label>
                <input
                  type="text"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={wasteForm.reason}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </div>
              <div className="md:col-span-5">
                <label className="text-xs text-muted-foreground">Note</label>
                <input
                  type="text"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={wasteForm.note}
                  onChange={(e) => setWasteForm((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="Optional context for operators"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => void createWaste()}
                  disabled={creatingWaste || itemsLoading}
                  className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60"
                >
                  {creatingWaste ? 'Submitting...' : 'Create Waste'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="surface-elevated p-4">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Waste Records</div>
                <div className="mt-1 text-2xl font-semibold">{wasteTotal}</div>
              </div>
              <div className="surface-elevated p-4">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Waste Qty</div>
                <div className="mt-1 text-2xl font-semibold">{wasteSummary.totalQuantity.toFixed(2)}</div>
              </div>
              <div className="surface-elevated p-4">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Latest Record</div>
                <div className="mt-1 text-sm font-medium">{formatDateTime(wasteSummary.latestAt)}</div>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Waste History ({wasteTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search item, note, or reason"
                      value={wasteQuery.searchInput}
                      onChange={(event) => wasteQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${wasteQuery.sortBy || 'txnTime'}:${wasteQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      wasteQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="txnTime:desc">Latest First</option>
                    <option value="txnTime:asc">Oldest First</option>
                    <option value="businessDate:desc">Business Date ↓</option>
                    <option value="businessDate:asc">Business Date ↑</option>
                    <option value="itemId:asc">Item ↑</option>
                    <option value="itemId:desc">Item ↓</option>
                  </select>
                  <button
                    onClick={() => void loadWasteRecords()}
                    disabled={wasteLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', wasteLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              {wasteError ? <p className="text-xs text-destructive">{wasteError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Time</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Item</th>
                      <th className="text-right text-[11px] px-4 py-2.5">Qty</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Business Date</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Reason</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wasteLoading && wasteRecords.length === 0 ? (
                      <ListTableSkeleton columns={6} rows={6} />
                    ) : wasteRecords.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          No waste records found for this outlet yet.
                        </td>
                      </tr>
                    ) : wasteRecords.map((row) => (
                      <tr key={String(row.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(row.txnTime || row.createdAt)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{itemNameById.get(String(row.itemId)) || `Item ${row.itemId}`}</span>
                            <span className="text-[11px] text-muted-foreground capitalize">{formatWasteTxnType(row.txnType)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono">{formatQuantity(Math.abs(Number(row.qtyChange ?? 0)))}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.businessDate || '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{row.wasteReason || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ListPaginationControls
                total={wasteTotal}
                limit={wasteQuery.limit}
                offset={wasteQuery.offset}
                hasMore={wasteHasMore}
                disabled={wasteLoading}
                onPageChange={wasteQuery.setPage}
                onLimitChange={wasteQuery.setPageSize}
              />
            </div>
          </div>
        )}

        {itemsLoading && (activeTab === 'counts' || activeTab === 'waste') ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading item catalog...
          </div>
        ) : null}
      </div>

      <Dialog open={Boolean(selectedCountSessionId)} onOpenChange={(open) => {
        if (!open) setSelectedCountSessionId('');
      }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review Stock Count</DialogTitle>
            <DialogDescription>
              {selectedCountSession
                ? `${sessionShortLabel(selectedCountSession.id)} · ${selectedCountSession.countDate || 'No date'}`
                : 'Load the session detail before posting inventory changes.'}
            </DialogDescription>
          </DialogHeader>

          {countReviewLoading && !selectedCountSession?.lines?.length ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading stock count details...
            </div>
          ) : selectedCountSession ? (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Session</div>
                  <div className="mt-1 text-sm font-semibold">{sessionShortLabel(selectedCountSession.id)}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">{selectedCountSession.id}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</div>
                  <div className="mt-1 text-sm font-medium capitalize">{selectedCountSession.status || 'unknown'}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Count Date</div>
                  <div className="mt-1 text-sm font-medium">{selectedCountSession.countDate || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Variance Items</div>
                  <div className="mt-1 text-sm font-medium">{Number(selectedCountSession.varianceItems ?? selectedCountSession.lines?.length ?? 0)}</div>
                </div>
              </div>

              {selectedCountSession.note ? (
                <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <span className="font-medium">Note:</span> {selectedCountSession.note}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-[11px]">Item</th>
                      <th className="px-4 py-2.5 text-right text-[11px]">System Qty</th>
                      <th className="px-4 py-2.5 text-right text-[11px]">Actual Qty</th>
                      <th className="px-4 py-2.5 text-right text-[11px]">Variance</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Line Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedCountSession.lines || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          This stock count session has no line detail to review.
                        </td>
                      </tr>
                    ) : (
                      (selectedCountSession.lines || []).map((line: StockCountLineView, index) => (
                        <tr key={`${selectedCountSession.id}-${line.id || index}`} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-sm">
                            {itemNameById.get(String(line.itemId ?? '')) || `Item ${line.itemId ?? 'unknown'}`}
                          </td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">{formatQuantity(line.systemQty)}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">{formatQuantity(line.actualQty)}</td>
                          <td className={cn(
                            'px-4 py-2.5 text-right text-sm font-mono',
                            Number(line.varianceQty ?? 0) === 0 ? 'text-foreground' : 'text-amber-700',
                          )}
                          >
                            {formatQuantity(line.varianceQty)}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{line.note || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="py-6 text-sm text-muted-foreground">Session details are unavailable.</div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => setSelectedCountSessionId('')}
              className="h-9 rounded-md border px-3 text-sm hover:bg-accent"
            >
              Close
            </button>
            {selectedCountSession && String(selectedCountSession.status || '').toLowerCase() !== 'posted' ? (
              <button
                type="button"
                onClick={() => void postCount(selectedCountSession.id)}
                disabled={postingCountId === selectedCountSession.id || countReviewLoading}
                className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {postingCountId === selectedCountSession.id ? 'Posting...' : 'Confirm Post Count'}
              </button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
