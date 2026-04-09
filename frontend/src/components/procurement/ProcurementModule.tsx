import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, FileText, Truck, Receipt, CreditCard, Search, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  procurementApi,
  type GoodsReceiptView,
  type PurchaseOrderView,
  type SupplierInvoiceView,
  type SupplierPaymentView,
  type SupplierView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

type ProcTab = 'suppliers' | 'purchase-orders' | 'goods-receipts' | 'invoices' | 'payments';

const TABS: { key: ProcTab; label: string; icon: React.ElementType }[] = [
  { key: 'suppliers', label: 'Suppliers', icon: Building2 },
  { key: 'purchase-orders', label: 'Purchase Orders', icon: FileText },
  { key: 'goods-receipts', label: 'Goods Receipts', icon: Truck },
  { key: 'invoices', label: 'Invoices', icon: Receipt },
  { key: 'payments', label: 'Payments', icon: CreditCard },
];

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function TinyAction({
  label,
  busy,
  onClick,
  disabled,
}: {
  label: string;
  busy?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
    >
      {busy ? '...' : label}
    </button>
  );
}

export function ProcurementModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);
  const [activeTab, setActiveTab] = useState<ProcTab>('suppliers');

  const [supplierDirectory, setSupplierDirectory] = useState<SupplierView[]>([]);

  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [suppliersError, setSuppliersError] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierView[]>([]);
  const [suppliersTotal, setSuppliersTotal] = useState(0);
  const [suppliersHasMore, setSuppliersHasMore] = useState(false);

  const [poLoading, setPoLoading] = useState(false);
  const [poError, setPoError] = useState('');
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderView[]>([]);
  const [poTotal, setPoTotal] = useState(0);
  const [poHasMore, setPoHasMore] = useState(false);

  const [grLoading, setGrLoading] = useState(false);
  const [grError, setGrError] = useState('');
  const [goodsReceipts, setGoodsReceipts] = useState<GoodsReceiptView[]>([]);
  const [grTotal, setGrTotal] = useState(0);
  const [grHasMore, setGrHasMore] = useState(false);

  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [invoices, setInvoices] = useState<SupplierInvoiceView[]>([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [invoiceHasMore, setInvoiceHasMore] = useState(false);

  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [payments, setPayments] = useState<SupplierPaymentView[]>([]);
  const [paymentTotal, setPaymentTotal] = useState(0);
  const [paymentHasMore, setPaymentHasMore] = useState(false);

  const [actionKey, setActionKey] = useState('');

  const [supplierForm, setSupplierForm] = useState({
    supplierCode: '',
    name: '',
    contactName: '',
    phone: '',
    email: '',
    status: 'active',
  });

  const suppliersQuery = useListQueryState<{ status?: string }>({
    initialLimit: 20,
    initialSortBy: 'name',
    initialSortDir: 'asc',
    initialFilters: { status: undefined },
  });
  const poQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const grQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const invoiceQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const paymentQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const patchPoFilters = poQuery.patchFilters;
  const patchGrFilters = grQuery.patchFilters;
  const patchInvoiceFilters = invoiceQuery.patchFilters;
  const patchPaymentFilters = paymentQuery.patchFilters;

  const loadSupplierDirectory = useCallback(async () => {
    if (!token) {
      setSupplierDirectory([]);
      return;
    }
    try {
      const rows = await procurementApi.suppliers(token);
      setSupplierDirectory(Array.isArray(rows) ? rows : []);
    } catch {
      setSupplierDirectory([]);
    }
  }, [token]);

  const loadSuppliers = useCallback(async () => {
    if (!token) return;
    setSuppliersLoading(true);
    setSuppliersError('');
    try {
      const page = await procurementApi.suppliersPaged(token, {
        ...suppliersQuery.query,
        status: suppliersQuery.filters.status,
      });
      setSuppliers(page.items || []);
      setSuppliersTotal(page.total || page.totalCount || 0);
      setSuppliersHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Procurement suppliers load failed', error);
      setSuppliers([]);
      setSuppliersTotal(0);
      setSuppliersHasMore(false);
      setSuppliersError(getErrorMessage(error, 'Unable to load suppliers'));
    } finally {
      setSuppliersLoading(false);
    }
  }, [suppliersQuery.filters.status, suppliersQuery.query, token]);

  const loadPurchaseOrders = useCallback(async () => {
    if (!token) return;
    setPoLoading(true);
    setPoError('');
    try {
      const page = await procurementApi.purchaseOrders(token, {
        ...poQuery.query,
        outletId: outletId || undefined,
        status: poQuery.filters.status,
      });
      setPurchaseOrders(page.items || []);
      setPoTotal(page.total || page.totalCount || 0);
      setPoHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Procurement purchase orders load failed', error);
      setPurchaseOrders([]);
      setPoTotal(0);
      setPoHasMore(false);
      setPoError(getErrorMessage(error, 'Unable to load purchase orders'));
    } finally {
      setPoLoading(false);
    }
  }, [outletId, poQuery.filters.status, poQuery.query, token]);

  const loadGoodsReceipts = useCallback(async () => {
    if (!token) return;
    setGrLoading(true);
    setGrError('');
    try {
      const page = await procurementApi.goodsReceipts(token, {
        ...grQuery.query,
        outletId: outletId || undefined,
        status: grQuery.filters.status,
      });
      setGoodsReceipts(page.items || []);
      setGrTotal(page.total || page.totalCount || 0);
      setGrHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Procurement goods receipts load failed', error);
      setGoodsReceipts([]);
      setGrTotal(0);
      setGrHasMore(false);
      setGrError(getErrorMessage(error, 'Unable to load goods receipts'));
    } finally {
      setGrLoading(false);
    }
  }, [grQuery.filters.status, grQuery.query, outletId, token]);

  const loadInvoices = useCallback(async () => {
    if (!token) return;
    setInvoiceLoading(true);
    setInvoiceError('');
    try {
      const page = await procurementApi.invoices(token, {
        ...invoiceQuery.query,
        outletId: outletId || undefined,
        status: invoiceQuery.filters.status,
      });
      setInvoices(page.items || []);
      setInvoiceTotal(page.total || page.totalCount || 0);
      setInvoiceHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Procurement invoices load failed', error);
      setInvoices([]);
      setInvoiceTotal(0);
      setInvoiceHasMore(false);
      setInvoiceError(getErrorMessage(error, 'Unable to load invoices'));
    } finally {
      setInvoiceLoading(false);
    }
  }, [invoiceQuery.filters.status, invoiceQuery.query, outletId, token]);

  const loadPayments = useCallback(async () => {
    if (!token) return;
    setPaymentLoading(true);
    setPaymentError('');
    try {
      const page = await procurementApi.payments(token, {
        ...paymentQuery.query,
        outletId: outletId || undefined,
        status: paymentQuery.filters.status,
      });
      setPayments(page.items || []);
      setPaymentTotal(page.total || page.totalCount || 0);
      setPaymentHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Procurement payments load failed', error);
      setPayments([]);
      setPaymentTotal(0);
      setPaymentHasMore(false);
      setPaymentError(getErrorMessage(error, 'Unable to load payments'));
    } finally {
      setPaymentLoading(false);
    }
  }, [outletId, paymentQuery.filters.status, paymentQuery.query, token]);

  const reloadActiveTab = useCallback(async () => {
    if (activeTab === 'suppliers') await loadSuppliers();
    if (activeTab === 'purchase-orders') await loadPurchaseOrders();
    if (activeTab === 'goods-receipts') await loadGoodsReceipts();
    if (activeTab === 'invoices') await loadInvoices();
    if (activeTab === 'payments') await loadPayments();
  }, [activeTab, loadGoodsReceipts, loadInvoices, loadPayments, loadPurchaseOrders, loadSuppliers]);

  useEffect(() => {
    patchPoFilters({ outletId: outletId || undefined });
    patchGrFilters({ outletId: outletId || undefined });
    patchInvoiceFilters({ outletId: outletId || undefined });
    patchPaymentFilters({ outletId: outletId || undefined });
  }, [outletId, patchGrFilters, patchInvoiceFilters, patchPaymentFilters, patchPoFilters]);

  useEffect(() => {
    void loadSupplierDirectory();
  }, [loadSupplierDirectory]);

  useEffect(() => {
    if (activeTab !== 'suppliers') return;
    void loadSuppliers();
  }, [activeTab, loadSuppliers]);

  useEffect(() => {
    if (activeTab !== 'purchase-orders') return;
    void loadPurchaseOrders();
  }, [activeTab, loadPurchaseOrders]);

  useEffect(() => {
    if (activeTab !== 'goods-receipts') return;
    void loadGoodsReceipts();
  }, [activeTab, loadGoodsReceipts]);

  useEffect(() => {
    if (activeTab !== 'invoices') return;
    void loadInvoices();
  }, [activeTab, loadInvoices]);

  useEffect(() => {
    if (activeTab !== 'payments') return;
    void loadPayments();
  }, [activeTab, loadPayments]);

  const supplierById = useMemo(
    () => new Map(supplierDirectory.map((supplier) => [String(supplier.id), String(supplier.name || supplier.supplierCode || `Supplier ${supplier.id}`)])),
    [supplierDirectory],
  );

  const runAction = async (key: string, action: () => Promise<unknown>, successMessage: string) => {
    setActionKey(key);
    try {
      await action();
      toast.success(successMessage);
      await reloadActiveTab();
      await loadSupplierDirectory();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Action failed'));
    } finally {
      setActionKey('');
    }
  };

  const createSupplier = async () => {
    if (!token) return;
    if (!supplierForm.name.trim() || !supplierForm.supplierCode.trim()) {
      toast.error('Supplier code and name are required');
      return;
    }

    await runAction(
      'create-supplier',
      async () => {
        await procurementApi.createSupplier(token, {
          supplierCode: supplierForm.supplierCode.trim(),
          name: supplierForm.name.trim(),
          legalName: supplierForm.name.trim(),
          contactName: supplierForm.contactName || supplierForm.name.trim(),
          phone: supplierForm.phone || null,
          email: supplierForm.email || null,
          status: supplierForm.status,
          paymentTerms: 'NET30',
        });
      },
      'Supplier created',
    );

    setSupplierForm({ supplierCode: '', name: '', contactName: '', phone: '', email: '', status: 'active' });
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Procurement" />;
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
        {activeTab === 'suppliers' && (
          <div className="space-y-4">
            <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-7 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Code</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={supplierForm.supplierCode} onChange={(e) => setSupplierForm((p) => ({ ...p, supplierCode: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Name</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={supplierForm.name} onChange={(e) => setSupplierForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Contact</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={supplierForm.contactName} onChange={(e) => setSupplierForm((p) => ({ ...p, contactName: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Phone</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={supplierForm.phone} onChange={(e) => setSupplierForm((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Email</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={supplierForm.email} onChange={(e) => setSupplierForm((p) => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="flex items-end">
                <button onClick={() => void createSupplier()} disabled={actionKey === 'create-supplier'} className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">
                  {actionKey === 'create-supplier' ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Suppliers ({suppliersTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search suppliers"
                      value={suppliersQuery.searchInput}
                      onChange={(event) => suppliersQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={suppliersQuery.filters.status || 'all'}
                    onChange={(event) => suppliersQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${suppliersQuery.sortBy || 'name'}:${suppliersQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      suppliersQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="name:asc">Name A-Z</option>
                    <option value="name:desc">Name Z-A</option>
                    <option value="supplierCode:asc">Code A-Z</option>
                    <option value="supplierCode:desc">Code Z-A</option>
                  </select>
                  <button
                    onClick={() => void loadSuppliers()}
                    disabled={suppliersLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', suppliersLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              {suppliersError ? <p className="text-xs text-destructive">{suppliersError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Code</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Name</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Contact</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliersLoading && suppliers.length === 0 ? (
                      <ListTableSkeleton columns={4} rows={7} />
                    ) : suppliers.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No suppliers found</td></tr>
                    ) : suppliers.map((supplier) => (
                      <tr key={String(supplier.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(supplier.supplierCode || supplier.id)}</td>
                        <td className="px-4 py-2.5 text-sm">{String(supplier.name || '—')}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(supplier.contactName || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(supplier.status || '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ListPaginationControls
                total={suppliersTotal}
                limit={suppliersQuery.limit}
                offset={suppliersQuery.offset}
                hasMore={suppliersHasMore}
                disabled={suppliersLoading}
                onPageChange={suppliersQuery.setPage}
                onLimitChange={suppliersQuery.setPageSize}
              />
            </div>
          </div>
        )}

        {activeTab === 'purchase-orders' && (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Purchase Orders ({poTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search purchase orders"
                    value={poQuery.searchInput}
                    onChange={(event) => poQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={poQuery.filters.status || 'all'}
                  onChange={(event) => poQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="posted">Posted</option>
                </select>
                <button
                  onClick={() => void loadPurchaseOrders()}
                  disabled={poLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', poLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>
            {poError ? <p className="text-xs text-destructive">{poError}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">PO</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Supplier</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Amount</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {poLoading && purchaseOrders.length === 0 ? (
                    <ListTableSkeleton columns={5} rows={7} />
                  ) : purchaseOrders.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No purchase orders found</td></tr>
                  ) : purchaseOrders.map((row) => {
                    const id = String(row.id);
                    const status = String(row.status || '').toLowerCase();
                    return (
                      <tr key={id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(row.poNumber || id)}</td>
                        <td className="px-4 py-2.5 text-sm">{supplierById.get(String(row.supplierId)) || `Supplier ${row.supplierId || '—'}`}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.status || '—')}</td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono">{Number(row.totalAmount || 0).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <TinyAction
                            label="Approve"
                            busy={actionKey === `po:${id}`}
                            disabled={status === 'approved'}
                            onClick={() => void runAction(`po:${id}`, () => procurementApi.approvePurchaseOrder(token, id), 'Purchase order approved')}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPaginationControls
              total={poTotal}
              limit={poQuery.limit}
              offset={poQuery.offset}
              hasMore={poHasMore}
              disabled={poLoading}
              onPageChange={poQuery.setPage}
              onLimitChange={poQuery.setPageSize}
            />
          </div>
        )}

        {activeTab === 'goods-receipts' && (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Goods Receipts ({grTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search goods receipts"
                    value={grQuery.searchInput}
                    onChange={(event) => grQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={grQuery.filters.status || 'all'}
                  onChange={(event) => grQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="posted">Posted</option>
                </select>
                <button
                  onClick={() => void loadGoodsReceipts()}
                  disabled={grLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', grLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>
            {grError ? <p className="text-xs text-destructive">{grError}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">GR</th>
                    <th className="text-left text-[11px] px-4 py-2.5">PO</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {grLoading && goodsReceipts.length === 0 ? (
                    <ListTableSkeleton columns={4} rows={7} />
                  ) : goodsReceipts.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No goods receipts found</td></tr>
                  ) : goodsReceipts.map((row) => {
                    const id = String(row.id);
                    const status = String(row.status || '').toLowerCase();
                    return (
                      <tr key={id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(row.grNumber || row.receiptNumber || id)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(row.poNumber || row.poId || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.status || '—')}</td>
                        <td className="px-4 py-2.5 text-right space-x-2">
                          <TinyAction
                            label="Approve"
                            busy={actionKey === `gr-approve:${id}`}
                            disabled={status === 'approved' || status === 'posted'}
                            onClick={() => void runAction(`gr-approve:${id}`, () => procurementApi.approveGoodsReceipt(token, id), 'Goods receipt approved')}
                          />
                          <TinyAction
                            label="Post"
                            busy={actionKey === `gr-post:${id}`}
                            disabled={status === 'posted'}
                            onClick={() => void runAction(`gr-post:${id}`, () => procurementApi.postGoodsReceipt(token, id), 'Goods receipt posted')}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPaginationControls
              total={grTotal}
              limit={grQuery.limit}
              offset={grQuery.offset}
              hasMore={grHasMore}
              disabled={grLoading}
              onPageChange={grQuery.setPage}
              onLimitChange={grQuery.setPageSize}
            />
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Invoices ({invoiceTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search invoices"
                    value={invoiceQuery.searchInput}
                    onChange={(event) => invoiceQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={invoiceQuery.filters.status || 'all'}
                  onChange={(event) => invoiceQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="posted">Posted</option>
                </select>
                <button
                  onClick={() => void loadInvoices()}
                  disabled={invoiceLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', invoiceLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>
            {invoiceError ? <p className="text-xs text-destructive">{invoiceError}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">Invoice</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Supplier</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Amount</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceLoading && invoices.length === 0 ? (
                    <ListTableSkeleton columns={5} rows={7} />
                  ) : invoices.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No invoices found</td></tr>
                  ) : invoices.map((row) => {
                    const id = String(row.id);
                    const status = String(row.status || '').toLowerCase();
                    return (
                      <tr key={id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(row.invoiceNumber || id)}</td>
                        <td className="px-4 py-2.5 text-sm">{supplierById.get(String(row.supplierId)) || `Supplier ${row.supplierId || '—'}`}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.status || '—')}</td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono">{Number(row.totalAmount || 0).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <TinyAction
                            label="Approve"
                            busy={actionKey === `inv:${id}`}
                            disabled={status === 'approved' || status === 'posted'}
                            onClick={() => void runAction(`inv:${id}`, () => procurementApi.approveInvoice(token, id), 'Invoice approved')}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPaginationControls
              total={invoiceTotal}
              limit={invoiceQuery.limit}
              offset={invoiceQuery.offset}
              hasMore={invoiceHasMore}
              disabled={invoiceLoading}
              onPageChange={invoiceQuery.setPage}
              onLimitChange={invoiceQuery.setPageSize}
            />
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Payments ({paymentTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search payments"
                    value={paymentQuery.searchInput}
                    onChange={(event) => paymentQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={paymentQuery.filters.status || 'all'}
                  onChange={(event) => paymentQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <button
                  onClick={() => void loadPayments()}
                  disabled={paymentLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', paymentLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>
            {paymentError ? <p className="text-xs text-destructive">{paymentError}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">Payment</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Amount</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentLoading && payments.length === 0 ? (
                    <ListTableSkeleton columns={4} rows={7} />
                  ) : payments.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No payments found</td></tr>
                  ) : payments.map((row) => {
                    const id = String(row.id);
                    const status = String(row.status || '').toLowerCase();
                    return (
                      <tr key={id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(row.paymentRef || id)}</td>
                        <td className="px-4 py-2.5 text-xs">{String(row.status || '—')}</td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono">{Number(row.amount || 0).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right space-x-2">
                          <TinyAction
                            label="Post"
                            busy={actionKey === `pay-post:${id}`}
                            disabled={status === 'posted'}
                            onClick={() => void runAction(`pay-post:${id}`, () => procurementApi.postPayment(token, id), 'Payment posted')}
                          />
                          <TinyAction
                            label="Cancel"
                            busy={actionKey === `pay-cancel:${id}`}
                            disabled={status === 'cancelled'}
                            onClick={() => void runAction(`pay-cancel:${id}`, () => procurementApi.cancelPayment(token, id), 'Payment cancelled')}
                          />
                          <TinyAction
                            label="Reverse"
                            busy={actionKey === `pay-reverse:${id}`}
                            onClick={() => void runAction(`pay-reverse:${id}`, () => procurementApi.reversePayment(token, id), 'Payment reversed')}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPaginationControls
              total={paymentTotal}
              limit={paymentQuery.limit}
              offset={paymentQuery.offset}
              hasMore={paymentHasMore}
              disabled={paymentLoading}
              onPageChange={paymentQuery.setPage}
              onLimitChange={paymentQuery.setPageSize}
            />
          </div>
        )}

        {!outletId && (
          <div className="mt-4">
            <EmptyState
              title="Outlet scope not selected"
              description="Set outlet scope to view outlet-filtered procurement data."
            />
          </div>
        )}
      </div>
    </div>
  );
}
