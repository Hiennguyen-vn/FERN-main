import type {
  SaleDetailView,
  SaleLineItemView,
  SaleListItemView,
} from '@/api/fern-api';
import type { OrderLineItem, PaymentMethod, SaleOrder } from '@/types/pos';

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatPosCurrency(value: number | null | undefined, currencyCode?: string | null) {
  const currency = String(currencyCode || 'USD').toUpperCase();
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'VND' ? 0 : 2,
    maximumFractionDigits: currency === 'VND' ? 0 : 2,
  }).format(amount);
}

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function distributeAmountAcrossItems(items: OrderLineItem[], totalAmount: number) {
  if (items.length === 0) {
    return [];
  }
  const totalLineAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (Math.abs(totalAmount) < 0.005 || totalLineAmount <= 0) {
    return items.map(() => 0);
  }

  let remaining = roundCurrency(totalAmount);
  return items.map((item, index) => {
    if (index === items.length - 1) {
      return remaining;
    }
    const share = roundCurrency((item.lineTotal / totalLineAmount) * totalAmount);
    remaining = roundCurrency(remaining - share);
    return share;
  });
}

function mapLineItem(
  saleId: string,
  item: SaleLineItemView,
  index: number,
  productNameById: Map<string, string>,
): OrderLineItem {
  const productId = String(item.productId ?? '');
  return {
    id: `${saleId}-li-${index}`,
    productId,
    productName: productNameById.get(productId) || `Product ${productId || index + 1}`,
    category: 'Product',
    quantity: toNumber(item.quantity),
    unitPrice: toNumber(item.unitPrice),
    lineTotal: toNumber(item.lineTotal),
    note: item.note ? String(item.note) : undefined,
  };
}

export function mapSaleToUi(
  sale: SaleListItemView,
  detail: SaleDetailView | null,
  outletNameFallback: string,
  operatorName: string,
  sessionCodeById: Map<string, string>,
  productNameById: Map<string, string>,
): SaleOrder {
  const status = String((detail?.status ?? sale?.status ?? '')).toLowerCase();
  const paymentStatusRaw = String((detail?.paymentStatus ?? sale?.paymentStatus ?? '')).toLowerCase();
  const sessionId = detail?.posSessionId != null ? String(detail.posSessionId) : sale?.posSessionId != null ? String(sale.posSessionId) : '';
  const publicOrderToken = detail?.publicOrderToken ?? sale?.publicOrderToken ?? null;
  const orderingTableCode = detail?.orderingTableCode ?? sale?.orderingTableCode ?? null;
  const orderingTableName = detail?.orderingTableName ?? sale?.orderingTableName ?? null;
  const isPublicOrder = Boolean(publicOrderToken || orderingTableCode || orderingTableName);
  const currencyCode = String(detail?.currencyCode ?? sale?.currencyCode ?? 'USD').toUpperCase();

  const lineItems: OrderLineItem[] = Array.isArray(detail?.items)
    ? detail.items.map((item, index) => mapLineItem(String(sale.id), item, index, productNameById))
    : [];

  const payments = detail?.payment
    ? [{
        id: `${sale.id}-pay-1`,
        method: String(detail.payment.paymentMethod ?? 'cash') as PaymentMethod,
        amount: toNumber(detail.payment.amount),
        capturedAt: String(detail.payment.paymentTime ?? detail.createdAt ?? new Date().toISOString()),
        reference: detail.payment.transactionRef ? String(detail.payment.transactionRef) : undefined,
      }]
    : [];

  return {
    id: String(sale.id),
    orderNumber: isPublicOrder
      ? `QR-${String(publicOrderToken || sale.id).slice(-6)}`
      : `SO-${String(sale.id).slice(-6)}`,
    sessionId,
    sessionCode: sessionCodeById.get(sessionId) || '—',
    backendStatus: status,
    orderType: detail?.orderType ?? sale?.orderType ?? undefined,
    currencyCode,
    sourceLabel: isPublicOrder ? 'Customer table order' : 'Cashier order',
    publicOrderToken: publicOrderToken ? String(publicOrderToken) : undefined,
    outletName: outletNameFallback,
    createdBy: isPublicOrder ? 'Customer QR/table' : operatorName,
    createdAt: String(detail?.createdAt ?? sale?.createdAt ?? new Date().toISOString()),
    status: status === 'cancelled' ? 'cancelled' : (status === 'payment_done' || status === 'completed' ? 'completed' : 'open'),
    paymentStatus: paymentStatusRaw === 'paid' ? 'paid' : paymentStatusRaw === 'partially_paid' ? 'partial' : 'unpaid',
    lineItems,
    subtotal: toNumber(detail?.subtotal ?? sale?.subtotal),
    taxAmount: toNumber(detail?.taxAmount ?? sale?.taxAmount),
    total: toNumber(detail?.totalAmount ?? sale?.totalAmount),
    promotionCode: undefined,
    promotionDiscount: undefined,
    tableNumber: orderingTableCode ? String(orderingTableCode) : undefined,
    tableName: orderingTableName ? String(orderingTableName) : undefined,
    note: detail?.note ?? sale?.note ?? undefined,
    payments,
  };
}
