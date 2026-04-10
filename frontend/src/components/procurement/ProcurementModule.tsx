import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, FileText, Truck, Receipt, CreditCard, Search, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  procurementApi,
  type GoodsReceiptView,
  type ItemView,
  type PurchaseOrderView,
  type SupplierInvoiceView,
  type SupplierPaymentView,
  type SupplierView,
  productApi,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  GoodsReceiptCreatePanel,
  InvoiceCreatePanel,
  PaymentCreatePanel,
  PurchaseOrderCreatePanel,
} from '@/components/procurement/ProcurementCreatePanels';
import {
  formatProcurementAmount,
  formatProcurementStatusLabel,
  procurementStatusTone,
} from '@/components/procurement/formatters';
import {
  canApproveGoodsReceipt,
  canApprovePurchaseOrder,
  canApproveSupplierInvoice,
  canCancelSupplierPayment,
  canPostGoodsReceipt,
  canPostSupplierPayment,
  canReverseSupplierPayment,
  GOODS_RECEIPT_STATUSES,
  PURCHASE_ORDER_STATUSES,
  SUPPLIER_INVOICE_STATUSES,
  SUPPLIER_PAYMENT_STATUSES,
} from '@/components/procurement/status-flow';

type ProcTab = 'suppliers' | 'purchase-orders' | 'goods-receipts' | 'invoices' | 'payments';
type ProcurementDetailKind = 'purchase-order' | 'goods-receipt';

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

function shortRef(prefix: string, id: string | null | undefined) {
  const text = String(id ?? '').trim();
  if (!text) return prefix;
  return `${prefix}-${text.slice(-6)}`;
}

function formatDateLabel(value: string | null | undefined) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function formatDateTimeLabel(value: string | null | undefined) {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(text));
  } catch {
    return text;
  }
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

function StatusBadge({ status }: { status: string | null | undefined }) {
  const text = String(status || 'unknown');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
        procurementStatusTone(text),
      )}
    >
      {formatProcurementStatusLabel(text)}
    </span>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className={cn('mt-1 text-sm font-medium text-foreground break-words', mono && 'font-mono text-xs')}>{value}</div>
    </div>
  );
}

export function ProcurementModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);
  const [activeTab, setActiveTab] = useState<ProcTab>('suppliers');

  const [supplierDirectory, setSupplierDirectory] = useState<SupplierView[]>([]);
  const [itemDirectory, setItemDirectory] = useState<ItemView[]>([]);
  const [purchaseOrderDirectory, setPurchaseOrderDirectory] = useState<PurchaseOrderView[]>([]);
  const [goodsReceiptDirectory, setGoodsReceiptDirectory] = useState<GoodsReceiptView[]>([]);
  const [invoiceDirectory, setInvoiceDirectory] = useState<SupplierInvoiceView[]>([]);

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
  const [detailKey, setDetailKey] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailKind, setDetailKind] = useState<ProcurementDetailKind | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrderView | null>(null);
  const [selectedGoodsReceipt, setSelectedGoodsReceipt] = useState<GoodsReceiptView | null>(null);

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
    initialSortBy: 'orderDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const grQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'receiptTime',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const invoiceQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'invoiceDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const paymentQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'paymentTime',
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

  const loadItemDirectory = useCallback(async () => {
    if (!token) {
      setItemDirectory([]);
      return;
    }
    try {
      const rows = await productApi.items(token);
      setItemDirectory(Array.isArray(rows) ? rows : []);
    } catch {
      setItemDirectory([]);
    }
  }, [token]);

  const loadPurchaseOrderDirectory = useCallback(async () => {
    if (!token) {
      setPurchaseOrderDirectory([]);
      return;
    }
    try {
      const page = await procurementApi.purchaseOrders(token, {
        outletId: outletId || undefined,
        limit: 100,
        offset: 0,
        sortBy: 'orderDate',
        sortDir: 'desc',
      });
      setPurchaseOrderDirectory(page.items || []);
    } catch {
      setPurchaseOrderDirectory([]);
    }
  }, [outletId, token]);

  const loadGoodsReceiptDirectory = useCallback(async () => {
    if (!token) {
      setGoodsReceiptDirectory([]);
      return;
    }
    try {
      const page = await procurementApi.goodsReceipts(token, {
        outletId: outletId || undefined,
        limit: 100,
        offset: 0,
        sortBy: 'receiptTime',
        sortDir: 'desc',
      });
      setGoodsReceiptDirectory(page.items || []);
    } catch {
      setGoodsReceiptDirectory([]);
    }
  }, [outletId, token]);

  const loadInvoiceDirectory = useCallback(async () => {
    if (!token) {
      setInvoiceDirectory([]);
      return;
    }
    try {
      const page = await procurementApi.invoices(token, {
        outletId: outletId || undefined,
        limit: 100,
        offset: 0,
        sortBy: 'invoiceDate',
        sortDir: 'desc',
      });
      setInvoiceDirectory(page.items || []);
    } catch {
      setInvoiceDirectory([]);
    }
  }, [outletId, token]);

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

  const reloadLookups = useCallback(async () => {
    await Promise.all([
      loadSupplierDirectory(),
      loadItemDirectory(),
      loadPurchaseOrderDirectory(),
      loadGoodsReceiptDirectory(),
      loadInvoiceDirectory(),
    ]);
  }, [loadGoodsReceiptDirectory, loadInvoiceDirectory, loadItemDirectory, loadPurchaseOrderDirectory, loadSupplierDirectory]);

  useEffect(() => {
    patchPoFilters({ outletId: outletId || undefined });
    patchGrFilters({ outletId: outletId || undefined });
    patchInvoiceFilters({ outletId: outletId || undefined });
    patchPaymentFilters({ outletId: outletId || undefined });
  }, [outletId, patchGrFilters, patchInvoiceFilters, patchPaymentFilters, patchPoFilters]);

  useEffect(() => {
    void reloadLookups();
  }, [reloadLookups]);

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
  const itemById = useMemo(
    () => new Map(itemDirectory.map((item) => [String(item.id), item])),
    [itemDirectory],
  );
  const purchaseOrderById = useMemo(
    () => new Map(purchaseOrderDirectory.map((purchaseOrder) => [String(purchaseOrder.id), purchaseOrder])),
    [purchaseOrderDirectory],
  );

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailKind(null);
    setDetailError('');
    setDetailLoading(false);
    setSelectedPurchaseOrder(null);
    setSelectedGoodsReceipt(null);
    setDetailKey('');
  }, []);

  const openPurchaseOrderDetail = useCallback(async (purchaseOrderId: string) => {
    setDetailKey(`po-view:${purchaseOrderId}`);
    setDetailKind('purchase-order');
    setDetailOpen(true);
    setDetailError('');
    setDetailLoading(true);
    setSelectedPurchaseOrder(null);
    setSelectedGoodsReceipt(null);
    try {
      const detail = await procurementApi.purchaseOrder(token, purchaseOrderId);
      setSelectedPurchaseOrder(detail);
    } catch (error: unknown) {
      setDetailError(getErrorMessage(error, 'Unable to load purchase order detail'));
    } finally {
      setDetailLoading(false);
      setDetailKey('');
    }
  }, [token]);

  const openGoodsReceiptDetail = useCallback(async (goodsReceiptId: string) => {
    setDetailKey(`gr-view:${goodsReceiptId}`);
    setDetailKind('goods-receipt');
    setDetailOpen(true);
    setDetailError('');
    setDetailLoading(true);
    setSelectedPurchaseOrder(null);
    setSelectedGoodsReceipt(null);
    try {
      const detail = await procurementApi.goodsReceipt(token, goodsReceiptId);
      setSelectedGoodsReceipt(detail);
    } catch (error: unknown) {
      setDetailError(getErrorMessage(error, 'Unable to load goods receipt detail'));
    } finally {
      setDetailLoading(false);
      setDetailKey('');
    }
  }, [token]);

  const runAction = useCallback(async (key: string, action: () => Promise<unknown>, successMessage: string) => {
    setActionKey(key);
    try {
      await action();
      toast.success(successMessage);
      await reloadActiveTab();
      await reloadLookups();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Action failed'));
    } finally {
      setActionKey('');
    }
  }, [reloadActiveTab, reloadLookups]);

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

  const renderPurchaseOrderDetail = () => {
    if (!selectedPurchaseOrder) return null;
    const detail = selectedPurchaseOrder;
    const currencyCode = String(detail.currencyCode || 'USD');
    const supplierName = supplierById.get(String(detail.supplierId || '')) || `Supplier ${detail.supplierId || '—'}`;
    const lines = Array.isArray(detail.items) ? detail.items : [];

    return (
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DetailField label="PO reference" value={String(detail.poNumber || shortRef('PO', detail.id))} />
          <DetailField label="Supplier" value={supplierName} />
          <DetailField label="Status" value={<StatusBadge status={detail.status} />} />
          <DetailField label="Total" value={`${formatProcurementAmount(detail.totalAmount || detail.expectedTotal || 0, currencyCode)} ${currencyCode}`} />
          <DetailField label="Order date" value={formatDateLabel(detail.orderDate)} />
          <DetailField label="Expected delivery" value={formatDateLabel(detail.expectedDeliveryDate)} />
          <DetailField label="Approved at" value={formatDateTimeLabel(detail.approvedAt)} />
          <DetailField label="Full ID" value={detail.id} mono />
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Note</p>
          <p className="mt-1 text-sm text-foreground">{String(detail.note || 'No note')}</p>
        </div>

        <div className="rounded-xl border overflow-hidden">
          <div className="border-b bg-muted/30 px-4 py-3">
            <h4 className="text-sm font-semibold">Ordered Items</h4>
            <p className="text-xs text-muted-foreground">Review exactly what this purchase order asked the supplier to deliver.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b bg-muted/20">
                  <th className="px-4 py-2.5 text-left text-[11px]">Item</th>
                  <th className="px-4 py-2.5 text-right text-[11px]">Ordered</th>
                  <th className="px-4 py-2.5 text-right text-[11px]">Received</th>
                  <th className="px-4 py-2.5 text-left text-[11px]">UOM</th>
                  <th className="px-4 py-2.5 text-right text-[11px]">Unit Price</th>
                  <th className="px-4 py-2.5 text-right text-[11px]">Line Total</th>
                  <th className="px-4 py-2.5 text-left text-[11px]">Note</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">This purchase order has no line items.</td>
                  </tr>
                ) : lines.map((line, index) => {
                  const item = itemById.get(String(line.itemId || ''));
                  const orderedQty = Number(line.qtyOrdered || 0);
                  const unitPrice = Number(line.expectedUnitPrice || 0);
                  return (
                    <tr key={`${detail.id}-line-${line.itemId || index}`} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">{String(item?.name || item?.code || `Item ${line.itemId || index + 1}`)}</p>
                          <p className="text-[11px] text-muted-foreground">{String(item?.code || line.itemId || 'No item code')}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{orderedQty.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{Number(line.qtyReceived || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm">{String(line.uomCode || item?.baseUomCode || item?.unitCode || '—')}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{formatProcurementAmount(unitPrice, currencyCode)}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{formatProcurementAmount(orderedQty * unitPrice, currencyCode)}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{String(line.note || '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderGoodsReceiptDetail = () => {
    if (!selectedGoodsReceipt) return null;
    const detail = selectedGoodsReceipt;
    const linkedPurchaseOrder = purchaseOrderById.get(String(detail.poId || ''));
    const supplierId = String(detail.supplierId || linkedPurchaseOrder?.supplierId || '');
    const supplierName = supplierById.get(supplierId) || `Supplier ${supplierId || '—'}`;
    const currencyCode = String(detail.currencyCode || linkedPurchaseOrder?.currencyCode || 'USD');
    const lines = Array.isArray(detail.items) ? detail.items : [];

    return (
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DetailField label="GR reference" value={String(detail.receiptNumber || shortRef('GR', detail.id))} />
          <DetailField label="Purchase order" value={String(linkedPurchaseOrder?.poNumber || shortRef('PO', String(detail.poId || '')))} />
          <DetailField label="Supplier" value={supplierName} />
          <DetailField label="Status" value={<StatusBadge status={detail.status} />} />
          <DetailField label="Business date" value={formatDateLabel(detail.businessDate)} />
          <DetailField label="Receipt time" value={formatDateTimeLabel(detail.receiptTime)} />
          <DetailField label="Supplier lot" value={String(detail.supplierLotNumber || 'No supplier lot')} />
          <DetailField label="Total" value={`${formatProcurementAmount(detail.totalPrice || 0, currencyCode)} ${currencyCode}`} />
          <DetailField label="Approved at" value={formatDateTimeLabel(detail.approvedAt)} />
          <DetailField label="Full ID" value={detail.id} mono />
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Note</p>
          <p className="mt-1 text-sm text-foreground">{String(detail.note || 'No note')}</p>
        </div>

        <div className="rounded-xl border overflow-hidden">
          <div className="border-b bg-muted/30 px-4 py-3">
            <h4 className="text-sm font-semibold">Received Items</h4>
            <p className="text-xs text-muted-foreground">These are the exact goods recorded into stock for this receipt.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b bg-muted/20">
                  <th className="px-4 py-2.5 text-left text-[11px]">Item</th>
                  <th className="px-4 py-2.5 text-right text-[11px]">Received</th>
                  <th className="px-4 py-2.5 text-left text-[11px]">UOM</th>
                  <th className="px-4 py-2.5 text-right text-[11px]">Unit Cost</th>
                  <th className="px-4 py-2.5 text-right text-[11px]">Line Total</th>
                  <th className="px-4 py-2.5 text-left text-[11px]">Mfg</th>
                  <th className="px-4 py-2.5 text-left text-[11px]">Expiry</th>
                  <th className="px-4 py-2.5 text-left text-[11px]">Note</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">This goods receipt has no received lines.</td>
                  </tr>
                ) : lines.map((line, index) => {
                  const item = itemById.get(String(line.itemId || ''));
                  return (
                    <tr key={`${detail.id}-line-${line.id || index}`} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">{String(item?.name || item?.code || `Item ${line.itemId || index + 1}`)}</p>
                          <p className="text-[11px] text-muted-foreground">{String(item?.code || line.itemId || 'No item code')}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{Number(line.qtyReceived || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm">{String(line.uomCode || item?.baseUomCode || item?.unitCode || '—')}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{Number(line.unitCost || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono">{Number(line.lineTotal || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm">{formatDateLabel(line.manufactureDate)}</td>
                      <td className="px-4 py-3 text-sm">{formatDateLabel(line.expiryDate)}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{String(line.note || '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

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
          <div className="space-y-4">
            <PurchaseOrderCreatePanel
              token={token}
              outletId={outletId}
              suppliers={supplierDirectory}
              items={itemDirectory}
              onCreated={async () => {
                await reloadLookups();
                await loadPurchaseOrders();
              }}
            />

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
                    {PURCHASE_ORDER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {formatProcurementStatusLabel(status)}
                      </option>
                    ))}
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
                      <th className="text-right text-[11px] px-4 py-2.5">Actions</th>
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
                          <td className="px-4 py-2.5">
                            <div>
                              <p className="text-sm font-medium">{shortRef('PO', id)}</p>
                              <p className="text-[11px] text-muted-foreground">{formatDateLabel(row.orderDate)} · delivery {formatDateLabel(row.expectedDeliveryDate)}</p>
                              <p className="text-[10px] font-mono text-muted-foreground">{id}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div>
                              <p className="text-sm">{supplierById.get(String(row.supplierId)) || `Supplier ${row.supplierId || '—'}`}</p>
                              <p className="text-[11px] text-muted-foreground">{String(row.note || 'No note')}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs"><StatusBadge status={row.status} /></td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="text-sm font-mono">{formatProcurementAmount(row.totalAmount || row.expectedTotal || 0, row.currencyCode)}</div>
                            <div className="text-[11px] text-muted-foreground">{String(row.currencyCode || 'USD')}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <TinyAction
                                label="View"
                                busy={detailKey === `po-view:${id}`}
                                onClick={() => void openPurchaseOrderDetail(id)}
                              />
                              <TinyAction
                                label="Approve"
                                busy={actionKey === `po:${id}`}
                                disabled={!canApprovePurchaseOrder(status)}
                                onClick={() => void runAction(`po:${id}`, () => procurementApi.approvePurchaseOrder(token, id), 'Purchase order approved')}
                              />
                            </div>
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
          </div>
        )}

        {activeTab === 'goods-receipts' && (
          <div className="space-y-4">
            <GoodsReceiptCreatePanel
              token={token}
              outletId={outletId}
              suppliers={supplierDirectory}
              items={itemDirectory}
              purchaseOrders={purchaseOrderDirectory}
              onCreated={async () => {
                await reloadLookups();
                await loadGoodsReceipts();
              }}
            />

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
                    {GOODS_RECEIPT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {formatProcurementStatusLabel(status)}
                      </option>
                    ))}
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
                          <td className="px-4 py-2.5">
                            <div>
                              <p className="text-sm font-medium">{shortRef('GR', id)}</p>
                              <p className="text-[11px] text-muted-foreground">{formatDateLabel(row.businessDate)} · {formatProcurementAmount(row.totalPrice || 0, row.currencyCode)} {String(row.currencyCode || 'USD')}</p>
                              <p className="text-[10px] font-mono text-muted-foreground">{id}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div>
                              <p className="text-sm">{shortRef('PO', String(row.poId || ''))}</p>
                              <p className="text-[11px] text-muted-foreground">{String(row.supplierLotNumber || 'No supplier lot')}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs"><StatusBadge status={row.status} /></td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <TinyAction
                                label="View"
                                busy={detailKey === `gr-view:${id}`}
                                onClick={() => void openGoodsReceiptDetail(id)}
                              />
                              <TinyAction
                                label="Approve"
                                busy={actionKey === `gr-approve:${id}`}
                                disabled={!canApproveGoodsReceipt(status)}
                                onClick={() => void runAction(`gr-approve:${id}`, () => procurementApi.approveGoodsReceipt(token, id), 'Goods receipt approved')}
                              />
                              <TinyAction
                                label="Post"
                                busy={actionKey === `gr-post:${id}`}
                                disabled={!canPostGoodsReceipt(status)}
                                onClick={() => void runAction(`gr-post:${id}`, () => procurementApi.postGoodsReceipt(token, id), 'Goods receipt posted')}
                              />
                            </div>
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
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-4">
            <InvoiceCreatePanel
              token={token}
              outletId={outletId}
              suppliers={supplierDirectory}
              items={itemDirectory}
              goodsReceipts={goodsReceiptDirectory}
              onCreated={async () => {
                await reloadLookups();
                await loadInvoices();
              }}
            />

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
                    {SUPPLIER_INVOICE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {formatProcurementStatusLabel(status)}
                      </option>
                    ))}
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
                          <td className="px-4 py-2.5">
                            <div>
                              <p className="text-sm font-medium">{String(row.invoiceNumber || shortRef('INV', id))}</p>
                              <p className="text-[11px] text-muted-foreground">{formatDateLabel(row.invoiceDate)} · due {formatDateLabel(row.dueDate)}</p>
                              <p className="text-[10px] font-mono text-muted-foreground">{id}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div>
                              <p className="text-sm">{supplierById.get(String(row.supplierId)) || `Supplier ${row.supplierId || '—'}`}</p>
                              <p className="text-[11px] text-muted-foreground">{String(row.note || 'No note')}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs"><StatusBadge status={row.status} /></td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="text-sm font-mono">{formatProcurementAmount(row.totalAmount || 0, row.currencyCode)}</div>
                            <div className="text-[11px] text-muted-foreground">{String(row.currencyCode || 'USD')}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <TinyAction
                              label="Approve"
                              busy={actionKey === `inv:${id}`}
                              disabled={!canApproveSupplierInvoice(status)}
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
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="space-y-4">
            <PaymentCreatePanel
              token={token}
              outletId={outletId}
              suppliers={supplierDirectory}
              invoices={invoiceDirectory}
              onCreated={async () => {
                await reloadLookups();
                await loadPayments();
              }}
            />

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
                    {SUPPLIER_PAYMENT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {formatProcurementStatusLabel(status)}
                      </option>
                    ))}
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
                          <td className="px-4 py-2.5">
                            <div>
                              <p className="text-sm font-medium">{String(row.transactionRef || row.paymentNumber || shortRef('PAY', id))}</p>
                              <p className="text-[11px] text-muted-foreground">{supplierById.get(String(row.supplierId || '')) || `Supplier ${row.supplierId || '—'}`} · {formatDateTimeLabel(row.paymentTime)}</p>
                              <p className="text-[10px] font-mono text-muted-foreground">{id}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs"><StatusBadge status={row.status} /></td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="text-sm font-mono">{formatProcurementAmount(row.amount || row.totalAmount || 0, row.currencyCode)}</div>
                            <div className="text-[11px] text-muted-foreground">{String(row.currencyCode || 'USD')}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right space-x-2">
                            <TinyAction
                              label="Post"
                              busy={actionKey === `pay-post:${id}`}
                              disabled={!canPostSupplierPayment(status)}
                              onClick={() => void runAction(`pay-post:${id}`, () => procurementApi.postPayment(token, id), 'Payment posted')}
                            />
                            <TinyAction
                              label="Cancel"
                              busy={actionKey === `pay-cancel:${id}`}
                              disabled={!canCancelSupplierPayment(status)}
                              onClick={() => void runAction(`pay-cancel:${id}`, () => procurementApi.cancelPayment(token, id), 'Payment cancelled')}
                            />
                            <TinyAction
                              label="Reverse"
                              busy={actionKey === `pay-reverse:${id}`}
                              disabled={!canReverseSupplierPayment(status)}
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

      <Dialog open={detailOpen} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="max-w-5xl p-0">
          <div className="border-b px-6 py-5">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-base">
                {detailKind === 'goods-receipt' ? 'Goods Receipt Detail' : 'Purchase Order Detail'}
              </DialogTitle>
              <DialogDescription>
                {detailKind === 'goods-receipt'
                  ? 'Review the linked purchase order and the exact items received into stock.'
                  : 'Review supplier, timeline, and ordered items before moving this purchase order forward.'}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
            {detailLoading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Loading detail…</div>
            ) : detailError ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{detailError}</div>
            ) : detailKind === 'goods-receipt' ? (
              renderGoodsReceiptDetail()
            ) : (
              renderPurchaseOrderDetail()
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
