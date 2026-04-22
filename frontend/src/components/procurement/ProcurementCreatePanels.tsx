import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  procurementApi,
  type GoodsReceiptItemView,
  type GoodsReceiptView,
  type ItemView,
  type PurchaseOrderView,
  type SupplierInvoiceView,
  type SupplierPaymentView,
  type SupplierView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import {
  formatProcurementAmount,
  formatProcurementStatusLabel,
} from '@/components/procurement/formatters';
import {
  resolveGoodsReceiptCurrency,
} from '@/components/procurement/procurement-currency';
import { normalizeCurrencyCode } from '@/lib/org-currency';
import {
  canCreateGoodsReceiptFromPurchaseOrder,
  canCreateInvoiceFromGoodsReceipt,
  canCreatePaymentFromInvoice,
} from '@/components/procurement/status-flow';

type PurchaseOrderDraftLine = {
  key: string;
  itemId: string;
  uomCode: string;
  qtyOrdered: string;
  expectedUnitPrice: string;
  note: string;
};

type GoodsReceiptDraftLine = {
  key: string;
  itemId: string;
  itemName: string;
  uomCode: string;
  qtyOrdered: string;
  qtyReceivedBefore: string;
  qtyReceived: string;
  unitCost: string;
  manufactureDate: string;
  expiryDate: string;
  note: string;
};

type InvoiceDraftLine = {
  key: string;
  goodsReceiptItemId: string;
  description: string;
  qtyInvoiced: string;
  unitPrice: string;
  taxPercent: string;
  note: string;
};

function createDraftKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function toLongLike(value: string | number | null | undefined) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? text : null;
}

function toInputNumber(value: number | null | undefined, fallback = '') {
  return value === null || value === undefined || Number.isNaN(value) ? fallback : String(value);
}

function parsePositiveNumber(value: string, minimum = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > minimum ? numeric : 0;
}

function parseNonNegativeNumber(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function formatMoney(value: number, currencyCode?: string | null) {
  return formatProcurementAmount(value, currencyCode);
}

function formatDate(value: string | null | undefined) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function formatDateTime(value: string | null | undefined) {
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

function shortRef(prefix: string, id: string | null | undefined) {
  const text = String(id ?? '').trim();
  if (!text) return prefix;
  return `${prefix}-${text.slice(-6)}`;
}

function supplierLabel(supplier: SupplierView) {
  return String(supplier.name || supplier.supplierCode || supplier.id);
}

function itemLabel(item: ItemView) {
  return String(item.name || item.code || item.id);
}

function receiptLabel(receipt: GoodsReceiptView) {
  return String(receipt.receiptNumber || receipt.id);
}

function paymentLabel(payment: SupplierPaymentView) {
  return String(payment.transactionRef || payment.paymentNumber || shortRef('PAY', payment.id));
}

function createLocalDateTimeInputValue() {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function createPurchaseOrderLine(items: ItemView[]): PurchaseOrderDraftLine {
  const first = items[0];
  return {
    key: createDraftKey('po-line'),
    itemId: first ? String(first.id) : '',
    uomCode: String(first?.baseUomCode || first?.unitCode || 'kg'),
    qtyOrdered: '1',
    expectedUnitPrice: '0',
    note: '',
  };
}

function createGoodsReceiptLine(items: ItemView[]): GoodsReceiptDraftLine {
  const first = items[0];
  return {
    key: createDraftKey('gr-line'),
    itemId: first ? String(first.id) : '',
    itemName: first ? itemLabel(first) : '',
    uomCode: String(first?.baseUomCode || first?.unitCode || 'kg'),
    qtyOrdered: '0',
    qtyReceivedBefore: '0',
    qtyReceived: '1',
    unitCost: '0',
    manufactureDate: '',
    expiryDate: '',
    note: '',
  };
}

function createInvoiceNumber() {
  return `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;
}

function SectionLabel({ children }: { children: string }) {
  return <label className="text-[11px] font-medium text-muted-foreground">{children}</label>;
}

function HeaderNote({ children }: { children: string }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

function SummaryCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-dashed p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

interface SharedProps {
  token: string;
  outletId: string;
  onCreated: () => Promise<void>;
}

interface ScopeCurrencyProps {
  scopeCurrencyCode: string;
}

export function PurchaseOrderCreatePanel({
  token,
  outletId,
  scopeCurrencyCode,
  suppliers,
  items,
  onCreated,
}: SharedProps & ScopeCurrencyProps & {
  suppliers: SupplierView[];
  items: ItemView[];
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    supplierId: '',
    currencyCode: normalizeCurrencyCode(scopeCurrencyCode),
    orderDate: new Date().toISOString().slice(0, 10),
    expectedDeliveryDate: '',
    note: '',
  });
  const [lines, setLines] = useState<PurchaseOrderDraftLine[]>(() => [createPurchaseOrderLine(items)]);

  useEffect(() => {
    const nextCurrencyCode = normalizeCurrencyCode(scopeCurrencyCode);
    setForm((current) => (current.currencyCode === nextCurrencyCode
      ? current
      : { ...current, currencyCode: nextCurrencyCode }));
  }, [scopeCurrencyCode]);

  useEffect(() => {
    setLines((current) => (current.length > 0 ? current : [createPurchaseOrderLine(items)]));
  }, [items]);

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + parsePositiveNumber(line.qtyOrdered) * parseNonNegativeNumber(line.expectedUnitPrice), 0),
    [lines],
  );

  const updateLine = (key: string, patch: Partial<PurchaseOrderDraftLine>) => {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if (patch.itemId !== undefined) {
        const selected = items.find((item) => String(item.id) === patch.itemId);
        if (selected) {
          next.uomCode = String(selected.baseUomCode || selected.unitCode || next.uomCode || 'kg');
        }
      }
      return next;
    }));
  };

  const canCreate = Boolean(
    outletId
      && form.supplierId
      && form.orderDate
      && lines.length > 0
      && lines.every((line) => line.itemId && parsePositiveNumber(line.qtyOrdered) > 0),
  );

  const handleCreate = async () => {
    if (!canCreate) {
      toast.error('Supplier, order date, and at least one valid item line are required');
      return;
    }
    setBusy(true);
    try {
      await procurementApi.createPurchaseOrder(token, {
        supplierId: toLongLike(form.supplierId),
        outletId: toLongLike(outletId),
        currencyCode: normalizeCurrencyCode(form.currencyCode),
        orderDate: form.orderDate,
        expectedDeliveryDate: form.expectedDeliveryDate || null,
        note: form.note.trim() || null,
        items: lines.map((line) => ({
          itemId: toLongLike(line.itemId),
          uomCode: line.uomCode.trim() || 'kg',
          expectedUnitPrice: parseNonNegativeNumber(line.expectedUnitPrice),
          qtyOrdered: parsePositiveNumber(line.qtyOrdered),
          note: line.note.trim() || null,
        })),
      });
      toast.success('Purchase order created');
      setForm({
        supplierId: '',
        currencyCode: normalizeCurrencyCode(scopeCurrencyCode),
        orderDate: new Date().toISOString().slice(0, 10),
        expectedDeliveryDate: '',
        note: '',
      });
      setLines([createPurchaseOrderLine(items)]);
      await onCreated();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create purchase order'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface-elevated p-4 space-y-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Create Purchase Order</h3>
          <HeaderNote>Create a draft PO in the current outlet scope, then approve it from the live table before receiving goods.</HeaderNote>
        </div>
        <div className="text-xs font-mono text-muted-foreground">Expected total {formatMoney(total, form.currencyCode)} {form.currencyCode || 'USD'}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <SectionLabel>Supplier</SectionLabel>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.supplierId}
            onChange={(event) => setForm((current) => ({ ...current, supplierId: event.target.value }))}
          >
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => (
              <option key={String(supplier.id)} value={String(supplier.id)}>
                {supplierLabel(supplier)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <SectionLabel>Order Date</SectionLabel>
          <input
            type="date"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.orderDate}
            onChange={(event) => setForm((current) => ({ ...current, orderDate: event.target.value }))}
          />
        </div>
        <div>
          <SectionLabel>Expected Delivery</SectionLabel>
          <input
            type="date"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.expectedDeliveryDate}
            onChange={(event) => setForm((current) => ({ ...current, expectedDeliveryDate: event.target.value }))}
          />
        </div>
        <div>
          <SectionLabel>Currency</SectionLabel>
          <input
            className="mt-1 h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"
            value={form.currencyCode}
            readOnly
            aria-readonly="true"
          />
        </div>
      </div>

      <div>
        <SectionLabel>Note</SectionLabel>
        <input
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={form.note}
          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          placeholder="Order note"
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-3 py-2 text-left text-[11px]">Item</th>
              <th className="px-3 py-2 text-left text-[11px]">UOM</th>
              <th className="px-3 py-2 text-right text-[11px]">Qty</th>
              <th className="px-3 py-2 text-right text-[11px]">Unit Price</th>
              <th className="px-3 py-2 text-left text-[11px]">Note</th>
              <th className="px-3 py-2 text-right text-[11px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={line.itemId}
                    onChange={(event) => updateLine(line.key, { itemId: event.target.value })}
                  >
                    <option value="">Select item</option>
                    {items.map((item) => (
                      <option key={String(item.id)} value={String(item.id)}>
                        {itemLabel(item)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
                    value={line.uomCode}
                    onChange={(event) => updateLine(line.key, { uomCode: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-xs"
                    value={line.qtyOrdered}
                    onChange={(event) => updateLine(line.key, { qtyOrdered: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="h-8 w-28 rounded-md border border-input bg-background px-2 text-right text-xs"
                    value={line.expectedUnitPrice}
                    onChange={(event) => updateLine(line.key, { expectedUnitPrice: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={line.note}
                    onChange={(event) => updateLine(line.key, { note: event.target.value })}
                    placeholder="Line note"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setLines((current) => current.length === 1 ? current : current.filter((row) => row.key !== line.key))}
                    disabled={lines.length === 1}
                    className="h-8 rounded-md border px-2.5 text-[11px] hover:bg-accent disabled:opacity-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <button
          onClick={() => setLines((current) => [...current, createPurchaseOrderLine(items)])}
          className="h-9 rounded-md border px-3 text-xs font-medium hover:bg-accent"
        >
          Add Line
        </button>
        <button
          onClick={() => void handleCreate()}
          disabled={busy || !canCreate}
          className="h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? 'Creating...' : 'Create Purchase Order'}
        </button>
      </div>
    </div>
  );
}

export function GoodsReceiptCreatePanel({
  token,
  outletId,
  scopeCurrencyCode,
  suppliers,
  items,
  purchaseOrders,
  onCreated,
}: SharedProps & ScopeCurrencyProps & {
  suppliers: SupplierView[];
  items: ItemView[];
  purchaseOrders: PurchaseOrderView[];
}) {
  const [busy, setBusy] = useState(false);
  const [loadingPurchaseOrder, setLoadingPurchaseOrder] = useState(false);
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrderView | null>(null);
  const [form, setForm] = useState({
    poId: '',
    currencyCode: normalizeCurrencyCode(scopeCurrencyCode),
    businessDate: new Date().toISOString().slice(0, 10),
    supplierLotNumber: '',
    note: '',
  });
  const [lines, setLines] = useState<GoodsReceiptDraftLine[]>(() => [createGoodsReceiptLine(items)]);

  useEffect(() => {
    setLines((current) => (current.length > 0 ? current : [createGoodsReceiptLine(items)]));
  }, [items]);

  const itemNameById = useMemo(
    () => new Map(items.map((item) => [String(item.id), itemLabel(item)])),
    [items],
  );
  const supplierNameById = useMemo(
    () => new Map(suppliers.map((supplier) => [String(supplier.id), supplierLabel(supplier)])),
    [suppliers],
  );
  const availablePurchaseOrders = useMemo(
    () => purchaseOrders.filter((row) => canCreateGoodsReceiptFromPurchaseOrder(row.status)),
    [purchaseOrders],
  );

  useEffect(() => {
    if (selectedPurchaseOrder) {
      return;
    }
    const nextCurrencyCode = resolveGoodsReceiptCurrency({
      scopeCurrencyCode,
    });
    setForm((current) => (current.currencyCode === nextCurrencyCode
      ? current
      : { ...current, currencyCode: nextCurrencyCode }));
  }, [scopeCurrencyCode, selectedPurchaseOrder]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !form.poId) {
      setSelectedPurchaseOrder(null);
      setForm((current) => ({
        ...current,
        currencyCode: resolveGoodsReceiptCurrency({
          scopeCurrencyCode,
        }),
      }));
      setLines([createGoodsReceiptLine(items)]);
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      setLoadingPurchaseOrder(true);
      try {
        const purchaseOrder = await procurementApi.purchaseOrder(token, form.poId);
        if (cancelled) return;
        setSelectedPurchaseOrder(purchaseOrder);
        setForm((current) => ({
          ...current,
          currencyCode: resolveGoodsReceiptCurrency({
            purchaseOrderCurrencyCode: purchaseOrder.currencyCode,
            scopeCurrencyCode,
          }),
        }));
        const poLines = (purchaseOrder.items || [])
          .map((line) => {
            const qtyOrdered = Number(line.qtyOrdered || 0);
            const qtyReceivedBefore = Number(line.qtyReceived || 0);
            const qtyRemaining = Math.max(qtyOrdered - qtyReceivedBefore, 0);
            return {
              key: createDraftKey('gr-line'),
              itemId: String(line.itemId || ''),
              itemName: itemNameById.get(String(line.itemId || '')) || `Item ${String(line.itemId || '—')}`,
              uomCode: String(line.uomCode || 'kg'),
              qtyOrdered: toInputNumber(qtyOrdered, '0'),
              qtyReceivedBefore: toInputNumber(qtyReceivedBefore, '0'),
              qtyReceived: qtyRemaining > 0 ? toInputNumber(qtyRemaining, '0') : '0',
              unitCost: toInputNumber(line.expectedUnitPrice, '0'),
              manufactureDate: '',
              expiryDate: '',
              note: String(line.note || ''),
            } satisfies GoodsReceiptDraftLine;
          })
          .filter((line) => parsePositiveNumber(line.qtyOrdered) > 0);

        setLines(poLines.length > 0 ? poLines : [createGoodsReceiptLine(items)]);
      } catch (error: unknown) {
        if (!cancelled) {
          setSelectedPurchaseOrder(null);
          setForm((current) => ({
            ...current,
            currencyCode: resolveGoodsReceiptCurrency({
              scopeCurrencyCode,
            }),
          }));
          setLines([createGoodsReceiptLine(items)]);
          toast.error(getErrorMessage(error, 'Unable to load purchase order detail'));
        }
      } finally {
        if (!cancelled) {
          setLoadingPurchaseOrder(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [form.poId, itemNameById, items, scopeCurrencyCode, token]);

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + parsePositiveNumber(line.qtyReceived) * parseNonNegativeNumber(line.unitCost), 0),
    [lines],
  );

  const updateLine = (key: string, patch: Partial<GoodsReceiptDraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const canCreate = Boolean(
    outletId
      && form.poId
      && form.businessDate
      && lines.length > 0
      && lines.some((line) => line.itemId && parsePositiveNumber(line.qtyReceived) > 0),
  );

  const handleCreate = async () => {
    if (!canCreate) {
      toast.error('Purchase order, business date, and at least one receiving line with quantity are required');
      return;
    }
    setBusy(true);
    try {
      const receiptLines = lines.filter((line) => line.itemId && parsePositiveNumber(line.qtyReceived) > 0);
      await procurementApi.createGoodsReceipt(token, {
        poId: toLongLike(form.poId),
        currencyCode: resolveGoodsReceiptCurrency({
          purchaseOrderCurrencyCode: selectedPurchaseOrder?.currencyCode,
          scopeCurrencyCode: form.currencyCode,
        }),
        businessDate: form.businessDate,
        totalPrice: total,
        supplierLotNumber: form.supplierLotNumber.trim() || null,
        note: form.note.trim() || null,
        items: receiptLines.map((line) => ({
          itemId: toLongLike(line.itemId),
          uomCode: line.uomCode.trim() || 'kg',
          qtyReceived: parsePositiveNumber(line.qtyReceived),
          unitCost: parseNonNegativeNumber(line.unitCost),
          manufactureDate: line.manufactureDate || null,
          expiryDate: line.expiryDate || null,
          note: line.note.trim() || null,
        })),
      });
      toast.success('Goods receipt created');
      setForm({
        poId: '',
        currencyCode: resolveGoodsReceiptCurrency({
          scopeCurrencyCode,
        }),
        businessDate: new Date().toISOString().slice(0, 10),
        supplierLotNumber: '',
        note: '',
      });
      setSelectedPurchaseOrder(null);
      setLines([createGoodsReceiptLine(items)]);
      await onCreated();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create goods receipt'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface-elevated p-4 space-y-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Create Goods Receipt</h3>
          <HeaderNote>Select an approved, ordered, or partially received purchase order to preload its remaining lines, then capture what actually arrived.</HeaderNote>
        </div>
        <div className="text-xs font-mono text-muted-foreground">Receipt total {formatMoney(total, form.currencyCode)} {form.currencyCode || 'USD'}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <SectionLabel>Purchase Order</SectionLabel>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.poId}
            onChange={(event) => setForm((current) => ({ ...current, poId: event.target.value }))}
          >
            <option value="">Select PO</option>
            {availablePurchaseOrders.map((purchaseOrder) => (
              <option key={String(purchaseOrder.id)} value={String(purchaseOrder.id)}>
                {`${shortRef('PO', String(purchaseOrder.id))} · ${supplierNameById.get(String(purchaseOrder.supplierId || '')) || 'Supplier'} · ${formatMoney(Number(purchaseOrder.expectedTotal || purchaseOrder.totalAmount || 0), purchaseOrder.currencyCode)} ${String(purchaseOrder.currencyCode || 'USD')} · ${formatProcurementStatusLabel(purchaseOrder.status)}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <SectionLabel>Business Date</SectionLabel>
          <input
            type="date"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.businessDate}
            onChange={(event) => setForm((current) => ({ ...current, businessDate: event.target.value }))}
          />
        </div>
        <div>
          <SectionLabel>Currency</SectionLabel>
          <input
            className="mt-1 h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"
            value={form.currencyCode}
            readOnly
            aria-readonly="true"
          />
        </div>
        <div>
          <SectionLabel>Supplier Lot</SectionLabel>
          <input
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.supplierLotNumber}
            onChange={(event) => setForm((current) => ({ ...current, supplierLotNumber: event.target.value }))}
            placeholder="LOT-..."
          />
        </div>
      </div>

      <div>
        <SectionLabel>Note</SectionLabel>
        <input
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={form.note}
          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          placeholder="Receipt note"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCell
          label="Supplier"
          value={selectedPurchaseOrder ? (supplierNameById.get(String(selectedPurchaseOrder.supplierId || '')) || `Supplier ${String(selectedPurchaseOrder.supplierId || '—')}`) : 'Select purchase order'}
        />
        <SummaryCell
          label="PO Reference"
          value={selectedPurchaseOrder ? `${shortRef('PO', String(selectedPurchaseOrder.id))} · ${formatDate(selectedPurchaseOrder.orderDate)}` : 'Waiting for selection'}
        />
        <SummaryCell
          label="Expected Delivery"
          value={selectedPurchaseOrder ? formatDate(selectedPurchaseOrder.expectedDeliveryDate) : '—'}
        />
        <SummaryCell
          label="PO Total"
          value={selectedPurchaseOrder ? `${formatMoney(Number(selectedPurchaseOrder.expectedTotal || selectedPurchaseOrder.totalAmount || 0), selectedPurchaseOrder.currencyCode)} ${String(selectedPurchaseOrder.currencyCode || 'USD')}` : '—'}
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-3 py-2 text-left text-[11px]">Item</th>
              <th className="px-3 py-2 text-right text-[11px]">Ordered</th>
              <th className="px-3 py-2 text-right text-[11px]">Received</th>
              <th className="px-3 py-2 text-right text-[11px]">Receiving</th>
              <th className="px-3 py-2 text-right text-[11px]">Unit Cost</th>
              <th className="px-3 py-2 text-left text-[11px]">Mfg</th>
              <th className="px-3 py-2 text-left text-[11px]">Expiry</th>
              <th className="px-3 py-2 text-left text-[11px]">Note</th>
            </tr>
          </thead>
          <tbody>
            {loadingPurchaseOrder ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">Loading purchase order detail...</td>
              </tr>
            ) : lines.map((line) => (
              <tr key={line.key} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="min-w-[220px]">
                    <p className="text-sm font-medium">{line.itemName || `Item ${line.itemId || '—'}`}</p>
                    <p className="text-[11px] text-muted-foreground">{line.uomCode} · {shortRef('ITEM', line.itemId)}</p>
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-xs font-mono">{formatMoney(parseNonNegativeNumber(line.qtyOrdered))}</td>
                <td className="px-3 py-2 text-right text-xs font-mono">{formatMoney(parseNonNegativeNumber(line.qtyReceivedBefore))}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-xs"
                    value={line.qtyReceived}
                    onChange={(event) => updateLine(line.key, { qtyReceived: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="h-8 w-28 rounded-md border border-input bg-background px-2 text-right text-xs"
                    value={line.unitCost}
                    onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="date"
                    className="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs"
                    value={line.manufactureDate}
                    onChange={(event) => updateLine(line.key, { manufactureDate: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="date"
                    className="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs"
                    value={line.expiryDate}
                    onChange={(event) => updateLine(line.key, { expiryDate: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={line.note}
                    onChange={(event) => updateLine(line.key, { note: event.target.value })}
                    placeholder="Line note"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p className="text-xs text-muted-foreground">
          Goods receipt lines are loaded from the selected purchase order. Set quantity to `0` for lines that did not arrive.
        </p>
        <button
          onClick={() => void handleCreate()}
          disabled={busy || loadingPurchaseOrder || !canCreate}
          className="h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? 'Creating...' : 'Create Goods Receipt'}
        </button>
      </div>
    </div>
  );
}

export function InvoiceCreatePanel({
  token,
  outletId,
  suppliers,
  items,
  goodsReceipts,
  onCreated,
}: SharedProps & {
  suppliers: SupplierView[];
  items: ItemView[];
  goodsReceipts: GoodsReceiptView[];
}) {
  const [busy, setBusy] = useState(false);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<GoodsReceiptView | null>(null);
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrderView | null>(null);
  const [lines, setLines] = useState<InvoiceDraftLine[]>([]);
  const [form, setForm] = useState({
    linkedReceiptId: '',
    invoiceNumber: createInvoiceNumber(),
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    note: '',
  });

  const itemNameById = useMemo(
    () => new Map(items.map((item) => [String(item.id), itemLabel(item)])),
    [items],
  );
  const supplierNameById = useMemo(
    () => new Map(suppliers.map((supplier) => [String(supplier.id), supplierLabel(supplier)])),
    [suppliers],
  );
  const availableGoodsReceipts = useMemo(
    () => goodsReceipts.filter((receipt) => canCreateInvoiceFromGoodsReceipt(receipt.status)),
    [goodsReceipts],
  );

  useEffect(() => {
    let cancelled = false;
    if (!token || !form.linkedReceiptId) {
      setSelectedReceipt(null);
      setSelectedPurchaseOrder(null);
      setLines([]);
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      setLoadingReceipt(true);
      try {
        const receipt = await procurementApi.goodsReceipt(token, form.linkedReceiptId);
        const purchaseOrder = await procurementApi.purchaseOrder(token, String(receipt.poId || ''));
        if (cancelled) return;
        setSelectedReceipt(receipt);
        setSelectedPurchaseOrder(purchaseOrder);
        setLines(
          (receipt.items || []).map((item: GoodsReceiptItemView) => ({
            key: createDraftKey('invoice-line'),
            goodsReceiptItemId: String(item.id),
            description: itemNameById.get(String(item.itemId || '')) || `Item ${item.itemId || item.id}`,
            qtyInvoiced: toInputNumber(item.qtyReceived, '1'),
            unitPrice: toInputNumber(item.unitCost, '0'),
            taxPercent: '0',
            note: String(item.note || ''),
          })),
        );
      } catch (error: unknown) {
        if (!cancelled) {
          setSelectedReceipt(null);
          setSelectedPurchaseOrder(null);
          setLines([]);
          toast.error(getErrorMessage(error, 'Unable to load goods receipt detail'));
        }
      } finally {
        if (!cancelled) {
          setLoadingReceipt(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [form.linkedReceiptId, itemNameById, token]);

  const updateLine = (key: string, patch: Partial<InvoiceDraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + parsePositiveNumber(line.qtyInvoiced) * parseNonNegativeNumber(line.unitPrice), 0),
    [lines],
  );
  const taxAmount = useMemo(
    () => lines.reduce((sum, line) => {
      const base = parsePositiveNumber(line.qtyInvoiced) * parseNonNegativeNumber(line.unitPrice);
      return sum + (base * parseNonNegativeNumber(line.taxPercent)) / 100;
    }, 0),
    [lines],
  );

  const canCreate = Boolean(
    outletId
      && form.linkedReceiptId
      && selectedPurchaseOrder?.supplierId
      && form.invoiceNumber
      && form.invoiceDate
      && lines.length > 0
      && lines.every((line) => line.goodsReceiptItemId && parsePositiveNumber(line.qtyInvoiced) > 0),
  );

  const handleCreate = async () => {
    if (!canCreate || !selectedPurchaseOrder?.supplierId) {
      toast.error('Select a goods receipt and wait for its lines to load before creating the invoice');
      return;
    }
    setBusy(true);
    try {
      await procurementApi.createInvoice(token, {
        invoiceNumber: form.invoiceNumber.trim(),
        supplierId: toLongLike(selectedPurchaseOrder.supplierId),
        currencyCode: selectedReceipt?.currencyCode || selectedPurchaseOrder.currencyCode || 'USD',
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate || null,
        subtotal,
        taxAmount,
        totalAmount: subtotal + taxAmount,
        note: form.note.trim() || null,
        linkedReceiptIds: [toLongLike(form.linkedReceiptId)],
        items: lines.map((line) => ({
          lineType: 'stock',
          goodsReceiptItemId: toLongLike(line.goodsReceiptItemId),
          description: line.description.trim() || null,
          qtyInvoiced: parsePositiveNumber(line.qtyInvoiced),
          unitPrice: parseNonNegativeNumber(line.unitPrice),
          taxPercent: parseNonNegativeNumber(line.taxPercent),
          taxAmount: (parsePositiveNumber(line.qtyInvoiced) * parseNonNegativeNumber(line.unitPrice) * parseNonNegativeNumber(line.taxPercent)) / 100,
          lineTotal: parsePositiveNumber(line.qtyInvoiced) * parseNonNegativeNumber(line.unitPrice),
          note: line.note.trim() || null,
        })),
      });
      toast.success('Invoice created');
      setForm({
        linkedReceiptId: '',
        invoiceNumber: createInvoiceNumber(),
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: '',
        note: '',
      });
      setSelectedReceipt(null);
      setSelectedPurchaseOrder(null);
      setLines([]);
      await onCreated();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create invoice'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface-elevated p-4 space-y-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Create Supplier Invoice</h3>
          <HeaderNote>Select a posted goods receipt to preload invoice lines, then create the draft invoice directly from this screen.</HeaderNote>
        </div>
        <div className="text-xs font-mono text-muted-foreground">Invoice total {formatMoney(subtotal + taxAmount, selectedReceipt?.currencyCode || selectedPurchaseOrder?.currencyCode)} {selectedReceipt?.currencyCode || selectedPurchaseOrder?.currencyCode || 'USD'}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <SectionLabel>Goods Receipt</SectionLabel>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.linkedReceiptId}
            onChange={(event) => setForm((current) => ({ ...current, linkedReceiptId: event.target.value }))}
          >
            <option value="">Select goods receipt</option>
            {availableGoodsReceipts.map((receipt) => (
              <option key={String(receipt.id)} value={String(receipt.id)}>
                {`${shortRef('GR', String(receipt.id))} · ${formatDate(receipt.businessDate)} · ${formatMoney(Number(receipt.totalPrice || 0), receipt.currencyCode)} ${String(receipt.currencyCode || 'USD')} · ${formatProcurementStatusLabel(receipt.status)}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <SectionLabel>Invoice Number</SectionLabel>
          <input
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.invoiceNumber}
            onChange={(event) => setForm((current) => ({ ...current, invoiceNumber: event.target.value }))}
          />
        </div>
        <div>
          <SectionLabel>Invoice Date</SectionLabel>
          <input
            type="date"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.invoiceDate}
            onChange={(event) => setForm((current) => ({ ...current, invoiceDate: event.target.value }))}
          />
        </div>
        <div>
          <SectionLabel>Due Date</SectionLabel>
          <input
            type="date"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.dueDate}
            onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCell
          label="Supplier"
          value={selectedPurchaseOrder
            ? (supplierNameById.get(String(selectedPurchaseOrder.supplierId || '')) || `Supplier ${String(selectedPurchaseOrder.supplierId || '—')}`)
            : 'Select a goods receipt'}
        />
        <SummaryCell
          label="Goods Receipt"
          value={selectedReceipt ? `${shortRef('GR', String(selectedReceipt.id))} · ${formatDate(selectedReceipt.businessDate)}` : 'Waiting for receipt'}
        />
        <SummaryCell
          label="Source PO"
          value={selectedPurchaseOrder ? `${shortRef('PO', String(selectedPurchaseOrder.id))} · ${formatDate(selectedPurchaseOrder.orderDate)}` : 'Waiting for receipt'}
        />
        <SummaryCell
          label="Receipt Status"
          value={loadingReceipt ? 'Loading...' : selectedReceipt ? formatProcurementStatusLabel(selectedReceipt.status) : '—'}
        />
      </div>

      <div>
        <SectionLabel>Note</SectionLabel>
        <input
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={form.note}
          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          placeholder="Invoice note"
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-3 py-2 text-left text-[11px]">Description</th>
              <th className="px-3 py-2 text-right text-[11px]">Qty</th>
              <th className="px-3 py-2 text-right text-[11px]">Unit Price</th>
              <th className="px-3 py-2 text-right text-[11px]">Tax %</th>
              <th className="px-3 py-2 text-right text-[11px]">Line Total</th>
              <th className="px-3 py-2 text-left text-[11px]">Note</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Select a goods receipt to load invoice lines
                </td>
              </tr>
            ) : lines.map((line) => {
              const lineSubtotal = parsePositiveNumber(line.qtyInvoiced) * parseNonNegativeNumber(line.unitPrice);
              return (
                <tr key={line.key} className="border-b last:border-0">
                  <td className="px-3 py-2 text-sm">{line.description}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-xs"
                      value={line.qtyInvoiced}
                      onChange={(event) => updateLine(line.key, { qtyInvoiced: event.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8 w-28 rounded-md border border-input bg-background px-2 text-right text-xs"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-xs"
                      value={line.taxPercent}
                      onChange={(event) => updateLine(line.key, { taxPercent: event.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-mono">{formatMoney(lineSubtotal)}</td>
                  <td className="px-3 py-2">
                    <input
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={line.note}
                      onChange={(event) => updateLine(line.key, { note: event.target.value })}
                      placeholder="Line note"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-muted-foreground">
          Subtotal {formatMoney(subtotal, selectedReceipt?.currencyCode || selectedPurchaseOrder?.currencyCode)} · Tax {formatMoney(taxAmount, selectedReceipt?.currencyCode || selectedPurchaseOrder?.currencyCode)} · Total {formatMoney(subtotal + taxAmount, selectedReceipt?.currencyCode || selectedPurchaseOrder?.currencyCode)}
        </div>
        <button
          onClick={() => void handleCreate()}
          disabled={busy || loadingReceipt || !canCreate}
          className="h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? 'Creating...' : 'Create Invoice'}
        </button>
      </div>
    </div>
  );
}

export function PaymentCreatePanel({
  token,
  outletId,
  suppliers,
  invoices,
  onCreated,
}: SharedProps & {
  suppliers: SupplierView[];
  invoices: SupplierInvoiceView[];
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    invoiceId: '',
    paymentMethod: 'bank_transfer',
    paymentTime: createLocalDateTimeInputValue(),
    allocatedAmount: '',
    transactionRef: `PAY-${Date.now().toString().slice(-6)}`,
    note: '',
  });

  const supplierNameById = useMemo(
    () => new Map(suppliers.map((supplier) => [String(supplier.id), supplierLabel(supplier)])),
    [suppliers],
  );
  const availableInvoices = useMemo(
    () => invoices.filter((invoice) => canCreatePaymentFromInvoice(invoice.status)),
    [invoices],
  );
  const selectedInvoice = useMemo(
    () => availableInvoices.find((invoice) => String(invoice.id) === form.invoiceId) ?? null,
    [availableInvoices, form.invoiceId],
  );

  useEffect(() => {
    if (!selectedInvoice) {
      return;
    }
    setForm((current) => ({
      ...current,
      allocatedAmount: current.allocatedAmount || toInputNumber(selectedInvoice.totalAmount, '0'),
    }));
  }, [selectedInvoice]);

  const canCreate = Boolean(
    outletId
      && selectedInvoice?.supplierId
      && form.paymentTime
      && parsePositiveNumber(form.allocatedAmount) > 0,
  );

  const handleCreate = async () => {
    if (!canCreate || !selectedInvoice?.supplierId) {
      toast.error('Select an invoice and enter a valid payment amount');
      return;
    }
    setBusy(true);
    try {
      const amount = parsePositiveNumber(form.allocatedAmount);
      await procurementApi.createPayment(token, {
        supplierId: toLongLike(selectedInvoice.supplierId),
        currencyCode: selectedInvoice.currencyCode || 'USD',
        paymentMethod: form.paymentMethod,
        amount,
        paymentTime: new Date(form.paymentTime).toISOString(),
        transactionRef: form.transactionRef.trim() || null,
        note: form.note.trim() || null,
        allocations: [
          {
            invoiceId: toLongLike(form.invoiceId),
            allocatedAmount: amount,
            note: form.note.trim() || null,
          },
        ],
      });
      toast.success('Payment created');
      setForm({
        invoiceId: '',
        paymentMethod: 'bank_transfer',
        paymentTime: createLocalDateTimeInputValue(),
        allocatedAmount: '',
        transactionRef: `PAY-${Date.now().toString().slice(-6)}`,
        note: '',
      });
      await onCreated();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create payment'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface-elevated p-4 space-y-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Create Payment</h3>
          <HeaderNote>Choose an approved or posted invoice, confirm the payable amount, then create the supplier payment directly from this tab.</HeaderNote>
        </div>
        <div className="text-xs font-mono text-muted-foreground">Payment amount {formatMoney(parsePositiveNumber(form.allocatedAmount), selectedInvoice?.currencyCode)} {selectedInvoice?.currencyCode || 'USD'}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <SectionLabel>Invoice</SectionLabel>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.invoiceId}
            onChange={(event) => setForm((current) => ({ ...current, invoiceId: event.target.value, allocatedAmount: '' }))}
          >
            <option value="">Select invoice</option>
            {availableInvoices.map((invoice) => (
              <option key={String(invoice.id)} value={String(invoice.id)}>
                {`${String(invoice.invoiceNumber || shortRef('INV', String(invoice.id)))} · ${supplierNameById.get(String(invoice.supplierId || '')) || 'Supplier'} · ${formatMoney(Number(invoice.totalAmount || 0), invoice.currencyCode)} ${String(invoice.currencyCode || 'USD')} · ${formatProcurementStatusLabel(invoice.status)}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <SectionLabel>Payment Method</SectionLabel>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.paymentMethod}
            onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}
          >
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="ewallet">E-Wallet</option>
            <option value="voucher">Voucher</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div>
          <SectionLabel>Payment Time</SectionLabel>
          <input
            type="datetime-local"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.paymentTime}
            onChange={(event) => setForm((current) => ({ ...current, paymentTime: event.target.value }))}
          />
        </div>
        <div>
          <SectionLabel>Amount</SectionLabel>
          <input
            type="number"
            min="0"
            step="0.01"
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-right"
            value={form.allocatedAmount}
            onChange={(event) => setForm((current) => ({ ...current, allocatedAmount: event.target.value }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCell
          label="Supplier"
          value={selectedInvoice ? (supplierNameById.get(String(selectedInvoice.supplierId || '')) || `Supplier ${String(selectedInvoice.supplierId || '—')}`) : 'Select an invoice'}
        />
        <SummaryCell
          label="Invoice"
          value={selectedInvoice ? String(selectedInvoice.invoiceNumber || shortRef('INV', String(selectedInvoice.id))) : 'Waiting for selection'}
        />
        <SummaryCell
          label="Invoice Date"
          value={selectedInvoice ? formatDate(selectedInvoice.invoiceDate) : '—'}
        />
        <SummaryCell
          label="Invoice Status"
          value={selectedInvoice ? formatProcurementStatusLabel(selectedInvoice.status) : '—'}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <SectionLabel>Transaction Ref</SectionLabel>
          <input
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.transactionRef}
            onChange={(event) => setForm((current) => ({ ...current, transactionRef: event.target.value }))}
            placeholder="PAY-..."
          />
        </div>
        <div>
          <SectionLabel>Note</SectionLabel>
          <input
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            placeholder="Payment note"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p className="text-xs text-muted-foreground">
          The current form creates one payment allocation against the selected invoice. This avoids ID-matching errors and keeps the payment trail clear.
        </p>
        <button
          onClick={() => void handleCreate()}
          disabled={busy || !canCreate}
          className="h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? 'Creating...' : 'Create Payment'}
        </button>
      </div>
    </div>
  );
}
