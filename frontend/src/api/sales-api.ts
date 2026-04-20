import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArray, decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord, asString } from '@/api/records';

export interface SaleLineItemView {
  productId?: string | null;
  note?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  discountAmount?: number | null;
  taxAmount?: number | null;
  lineTotal?: number | null;
  [key: string]: unknown;
}

export interface PaymentView {
  paymentMethod?: string | null;
  amount?: number | null;
  status?: string | null;
  paymentTime?: string | null;
  transactionRef?: string | null;
  [key: string]: unknown;
}

export interface SaleListItemView {
  id: string;
  outletId?: string | null;
  posSessionId?: string | null;
  publicOrderToken?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  orderType?: string | null;
  orderingTableCode?: string | null;
  orderingTableName?: string | null;
  currencyCode?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  note?: string | null;
  createdAt?: string | null;
  items?: SaleLineItemView[];
  payment?: PaymentView | null;
  [key: string]: unknown;
}

export type SaleDetailView = SaleListItemView;

export interface PosSessionView {
  id: string;
  outletId?: string | null;
  currencyCode?: string | null;
  managerId?: string | null;
  sessionCode?: string | null;
  status?: string | null;
  businessDate?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
  note?: string | null;
  orderCount?: number | null;
  totalRevenue?: number | null;
  [key: string]: unknown;
}

export interface OrderingTableView {
  id: string;
  tableToken?: string | null;
  code?: string | null;
  tableCode?: string | null;
  name?: string | null;
  tableName?: string | null;
  outletId?: string | null;
  outletCode?: string | null;
  outletName?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface PublicTableView {
  tableToken: string;
  tableCode?: string | null;
  tableName?: string | null;
  status?: string | null;
  outletCode?: string | null;
  outletName?: string | null;
  currencyCode?: string | null;
  timezoneName?: string | null;
  businessDate?: string | null;
  [key: string]: unknown;
}

export interface PublicMenuItemView {
  productId: string;
  code?: string | null;
  name?: string | null;
  categoryCode?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  priceValue?: number | null;
  currencyCode?: string | null;
  [key: string]: unknown;
}

export interface CreatePublicOrderPayload {
  items: Array<{
    productId: string | number;
    quantity: number;
    note?: string | null;
  }>;
  note?: string | null;
}

export interface PublicOrderLineView {
  productId?: string | null;
  productCode?: string | null;
  productName?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface PublicOrderReceiptView {
  orderToken: string;
  tableCode?: string | null;
  tableName?: string | null;
  outletCode?: string | null;
  outletName?: string | null;
  currencyCode?: string | null;
  orderStatus?: string | null;
  paymentStatus?: string | null;
  totalAmount?: number | null;
  note?: string | null;
  createdAt?: string | null;
  items?: PublicOrderLineView[];
  [key: string]: unknown;
}

export interface OutletHourlyRevenueView {
  hour?: string | null;
  revenue?: number | null;
  [key: string]: unknown;
}

export interface OutletStatsView {
  outletId?: string | null;
  businessDate?: string | null;
  totalOrders?: number | null;
  totalRevenue?: number | null;
  ordersToday?: number | null;
  completedSales?: number | null;
  cancelledOrders?: number | null;
  revenueToday?: number | null;
  averageOrderValue?: number | null;
  activeSessionCode?: string | null;
  activeSessionStatus?: string | null;
  topCategory?: string | null;
  peakHour?: string | null;
  hourlyRevenue?: OutletHourlyRevenueView[];
  [key: string]: unknown;
}

export interface PromotionView {
  id: string;
  code?: string | null;
  name?: string | null;
  promoType?: string | null;
  status?: string | null;
  valueAmount?: number | null;
  valuePercent?: number | null;
  minOrderAmount?: number | null;
  maxDiscountAmount?: number | null;
  outletIds?: string[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  [key: string]: unknown;
}

export interface CreatePromotionPayload {
  name: string;
  promoType: string;
  valueAmount?: number | null;
  valuePercent?: number | null;
  minOrderAmount?: number | null;
  maxDiscountAmount?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  outletIds: number[];
}

export interface MonthlyRevenueRow {
  outletId: string | number;
  month: string;
  orderCount: number;
  cancelledCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  taxAmount: number;
  totalAmount: number;
  voids: number;
  currencyCode?: string | null;
}

export interface RevenueMixEntry {
  key: string;
  amount: number;
  orderCount: number;
}

export interface DailyRevenueRow {
  outletId: string | number;
  businessDate: string;
  orderCount: number;
  cancelledCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  taxAmount: number;
  totalAmount: number;
  voids: number;
  currencyCode?: string | null;
  paymentMix: RevenueMixEntry[];
  channelMix: RevenueMixEntry[];
  paymentCodedOrders: number;
}

export interface SalesOrdersQuery {
  outletId?: string;
  limit?: number;
  offset?: number;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  status?: string;
  paymentStatus?: string;
  publicOrderOnly?: boolean;
  posSessionId?: string;
  startDate?: string;
  endDate?: string;
}

export interface PosSessionsQuery {
  outletId?: string;
  businessDate?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  managerId?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PromotionsQuery {
  outletId?: string;
  status?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CreateSalePayload {
  outletId: string | number;
  posSessionId?: string | number;
  currencyCode: string;
  orderType: string;
  note?: string | null;
  items: Array<{
    productId: string | number;
    quantity: number;
    discountAmount: number;
    taxAmount: number;
    note: null;
    promotionIds: Array<string | number>;
  }>;
}

export interface MarkPaymentDonePayload {
  paymentMethod: string;
  amount: number;
  paymentTime: string;
  note?: string | null;
}

export interface OpenPosSessionPayload {
  sessionCode: string;
  outletId: string | number;
  currencyCode: string;
  managerId: string | number;
  businessDate: string;
  note?: string | null;
}

function decodeLineItem(value: unknown): SaleLineItemView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    productId: asNullableString(record.productId),
    note: asNullableString(record.note),
    quantity: asNullableNumber(record.quantity),
    unitPrice: asNullableNumber(record.unitPrice),
    discountAmount: asNullableNumber(record.discountAmount),
    taxAmount: asNullableNumber(record.taxAmount),
    lineTotal: asNullableNumber(record.lineTotal),
  };
}

function decodePayment(value: unknown): PaymentView | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    ...record,
    paymentMethod: asNullableString(record.paymentMethod),
    amount: asNullableNumber(record.amount),
    status: asNullableString(record.status),
    paymentTime: asNullableString(record.paymentTime),
    transactionRef: asNullableString(record.transactionRef),
  };
}

function decodeSale(value: unknown): SaleListItemView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    posSessionId: asNullableString(record.posSessionId),
    publicOrderToken: asNullableString(record.publicOrderToken),
    status: asNullableString(record.status),
    paymentStatus: asNullableString(record.paymentStatus),
    orderType: asNullableString(record.orderType),
    orderingTableCode: asNullableString(record.orderingTableCode),
    orderingTableName: asNullableString(record.orderingTableName),
    currencyCode: asNullableString(record.currencyCode),
    subtotal: asNullableNumber(record.subtotal),
    discount: asNullableNumber(record.discount),
    taxAmount: asNullableNumber(record.taxAmount),
    totalAmount: asNullableNumber(record.totalAmount),
    note: asNullableString(record.note),
    createdAt: asNullableString(record.createdAt),
    items: Array.isArray(record.items) ? record.items.map(decodeLineItem) : [],
    payment: decodePayment(record.payment),
  };
}

function decodePosSession(value: unknown): PosSessionView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    currencyCode: asNullableString(record.currencyCode),
    managerId: asNullableString(record.managerId),
    sessionCode: asNullableString(record.sessionCode),
    status: asNullableString(record.status),
    businessDate: asDateOnly(record.businessDate),
    openedAt: asNullableString(record.openedAt),
    closedAt: asNullableString(record.closedAt),
    note: asNullableString(record.note),
    orderCount: asNullableNumber(record.orderCount),
    totalRevenue: asNullableNumber(record.totalRevenue),
  };
}

function decodeOrderingTable(value: unknown): OrderingTableView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    tableToken: asNullableString(record.tableToken),
    code: asNullableString(record.code),
    tableCode: asNullableString(record.tableCode),
    name: asNullableString(record.name),
    tableName: asNullableString(record.tableName),
    outletId: asNullableString(record.outletId),
    outletCode: asNullableString(record.outletCode),
    outletName: asNullableString(record.outletName),
    status: asNullableString(record.status),
  };
}

function decodePublicTable(value: unknown): PublicTableView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    tableToken: asId(record.tableToken),
    tableCode: asNullableString(record.tableCode),
    tableName: asNullableString(record.tableName),
    status: asNullableString(record.status),
    outletCode: asNullableString(record.outletCode),
    outletName: asNullableString(record.outletName),
    currencyCode: asNullableString(record.currencyCode),
    timezoneName: asNullableString(record.timezoneName),
    businessDate: asDateOnly(record.businessDate),
  };
}

function decodePublicMenuItem(value: unknown): PublicMenuItemView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    productId: asId(record.productId),
    code: asNullableString(record.code),
    name: asNullableString(record.name),
    categoryCode: asNullableString(record.categoryCode),
    description: asNullableString(record.description),
    imageUrl: asNullableString(record.imageUrl),
    priceValue: asNullableNumber(record.priceValue),
    currencyCode: asNullableString(record.currencyCode),
  };
}

function decodePublicOrderLine(value: unknown): PublicOrderLineView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    productId: asNullableString(record.productId),
    productCode: asNullableString(record.productCode),
    productName: asNullableString(record.productName),
    quantity: asNullableNumber(record.quantity),
    unitPrice: asNullableNumber(record.unitPrice),
    lineTotal: asNullableNumber(record.lineTotal),
    note: asNullableString(record.note),
  };
}

function decodePublicOrderReceipt(value: unknown): PublicOrderReceiptView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    orderToken: asId(record.orderToken),
    tableCode: asNullableString(record.tableCode),
    tableName: asNullableString(record.tableName),
    outletCode: asNullableString(record.outletCode),
    outletName: asNullableString(record.outletName),
    currencyCode: asNullableString(record.currencyCode),
    orderStatus: asNullableString(record.orderStatus),
    paymentStatus: asNullableString(record.paymentStatus),
    totalAmount: asNullableNumber(record.totalAmount),
    note: asNullableString(record.note),
    createdAt: asNullableString(record.createdAt),
    items: Array.isArray(record.items) ? record.items.map(decodePublicOrderLine) : [],
  };
}

function decodeOutletStats(value: unknown): OutletStatsView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    outletId: asNullableString(record.outletId),
    businessDate: asDateOnly(record.businessDate),
    totalOrders: asNullableNumber(record.totalOrders),
    totalRevenue: asNullableNumber(record.totalRevenue),
    ordersToday: asNullableNumber(record.ordersToday),
    completedSales: asNullableNumber(record.completedSales),
    cancelledOrders: asNullableNumber(record.cancelledOrders),
    revenueToday: asNullableNumber(record.revenueToday),
    averageOrderValue: asNullableNumber(record.averageOrderValue),
    activeSessionCode: asNullableString(record.activeSessionCode),
    activeSessionStatus: asNullableString(record.activeSessionStatus),
    topCategory: asNullableString(record.topCategory),
    peakHour: asNullableString(record.peakHour),
    hourlyRevenue: Array.isArray(record.hourlyRevenue)
      ? record.hourlyRevenue.map((entry) => {
          const hourlyRecord = asRecord(entry) ?? {};
          return {
            ...hourlyRecord,
            hour: asNullableString(hourlyRecord.hour),
            revenue: asNullableNumber(hourlyRecord.revenue),
          };
        })
      : [],
  };
}

function decodePromotion(value: unknown): PromotionView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    code: asNullableString(record.code),
    name: asNullableString(record.name),
    promoType: asNullableString(record.promoType),
    status: asNullableString(record.status),
    valueAmount: asNullableNumber(record.valueAmount),
    valuePercent: asNullableNumber(record.valuePercent),
    minOrderAmount: asNullableNumber(record.minOrderAmount),
    maxDiscountAmount: asNullableNumber(record.maxDiscountAmount),
    outletIds: Array.isArray(record.outletIds) ? record.outletIds.map((item) => asId(item)) : [],
    effectiveFrom: asNullableString(record.effectiveFrom),
    effectiveTo: asNullableString(record.effectiveTo),
  };
}

export const salesApi = {
  getPublicTable: async (tableToken: string): Promise<PublicTableView> =>
    decodePublicTable(await apiRequest(`/api/v1/sales/public/tables/${tableToken}`)),
  listPublicMenu: async (tableToken: string, onDate?: string): Promise<PublicMenuItemView[]> =>
    decodeArray(
      await apiRequest(`/api/v1/sales/public/tables/${tableToken}/menu`, { query: { onDate } }),
      decodePublicMenuItem,
    ),
  createPublicOrder: async (tableToken: string, payload: CreatePublicOrderPayload): Promise<PublicOrderReceiptView> =>
    decodePublicOrderReceipt(
      await apiRequest(`/api/v1/sales/public/tables/${tableToken}/orders`, {
        method: 'POST',
        body: {
          note: payload.note ?? null,
          items: payload.items.map((item) => ({
            productId: asId(item.productId),
            quantity: item.quantity,
            note: item.note ?? null,
          })),
        },
      }),
    ),
  getPublicOrder: async (tableToken: string, orderToken: string): Promise<PublicOrderReceiptView> =>
    decodePublicOrderReceipt(await apiRequest(`/api/v1/sales/public/tables/${tableToken}/orders/${orderToken}`)),
  orders: async (token: string, query: SalesOrdersQuery): Promise<PagedResponse<SaleListItemView>> =>
    decodePaged(await apiRequest('/api/v1/sales/orders', { token, query }), decodeSale),
  monthlyRevenue: async (
    token: string,
    query: { outletId?: string; startDate?: string; endDate?: string },
  ): Promise<MonthlyRevenueRow[]> => {
    const raw = await apiRequest<unknown>('/api/v1/sales/revenue/monthly', { token, query });
    return Array.isArray(raw) ? (raw as MonthlyRevenueRow[]) : [];
  },
  dailyRevenue: async (
    token: string,
    query: { outletId?: string; startDate?: string; endDate?: string },
  ): Promise<DailyRevenueRow[]> => {
    const raw = await apiRequest<unknown>('/api/v1/sales/revenue/daily', { token, query });
    return Array.isArray(raw) ? (raw as DailyRevenueRow[]) : [];
  },
  orderDetail: async (token: string, saleId: string): Promise<SaleDetailView> =>
    decodeSale(await apiRequest(`/api/v1/sales/orders/${saleId}`, { token })),
  createOrder: async (
    token: string,
    payload: CreateSalePayload,
    opts?: { idempotencyKey?: string }
  ): Promise<SaleDetailView> =>
    decodeSale(await apiRequest('/api/v1/sales/orders', {
      method: 'POST',
      token,
      body: payload,
      headers: opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : undefined,
    })),
  approveOrder: async (token: string, saleId: string): Promise<unknown> =>
    apiRequest(`/api/v1/sales/orders/${saleId}/approve`, { method: 'POST', token }),
  markPaymentDone: async (token: string, saleId: string, payload: MarkPaymentDonePayload): Promise<unknown> =>
    apiRequest(`/api/v1/sales/orders/${saleId}/mark-payment-done`, { method: 'POST', token, body: payload }),
  cancelOrder: async (token: string, saleId: string, payload?: { reason?: string | null }): Promise<unknown> =>
    apiRequest(`/api/v1/sales/orders/${saleId}/cancel`, { method: 'POST', token, body: payload ?? {} }),
  posSessions: async (token: string, query: PosSessionsQuery): Promise<PagedResponse<PosSessionView>> =>
    decodePaged(await apiRequest('/api/v1/sales/pos-sessions', { token, query }), decodePosSession),
  openPosSession: async (token: string, payload: OpenPosSessionPayload): Promise<PosSessionView> =>
    decodePosSession(await apiRequest('/api/v1/sales/pos-sessions', { method: 'POST', token, body: payload })),
  closePosSession: async (token: string, sessionId: string, payload?: { note?: string }): Promise<unknown> =>
    apiRequest(`/api/v1/sales/pos-sessions/${sessionId}/close`, { method: 'POST', token, body: payload ?? {} }),
  reconcilePosSession: async (
    token: string,
    sessionId: string,
    payload?: {
      lines?: Array<{ paymentMethod: string; actualAmount: number }>;
      note?: string;
    },
  ): Promise<unknown> =>
    apiRequest(`/api/v1/sales/pos-sessions/${sessionId}/reconcile`, { method: 'POST', token, body: payload ?? {} }),
  orderingTables: async (token: string, outletId: string, status?: string): Promise<OrderingTableView[]> =>
    decodeArray(await apiRequest('/api/v1/sales/ordering-tables', { token, query: { outletId, status } }), decodeOrderingTable),
  outletStats: async (token: string, outletId: string, onDate?: string): Promise<OutletStatsView> =>
    decodeOutletStats(await apiRequest('/api/v1/sales/outlet-stats', { token, query: { outletId, onDate } })),
  promotions: async (token: string, query: PromotionsQuery): Promise<PagedResponse<PromotionView>> =>
    decodePaged(await apiRequest('/api/v1/sales/promotions', { token, query }), decodePromotion),
  createPromotion: async (token: string, payload: CreatePromotionPayload): Promise<PromotionView> =>
    decodePromotion(await apiRequest('/api/v1/sales/promotions', { method: 'POST', token, body: payload })),
  deactivatePromotion: async (token: string, promotionId: string): Promise<unknown> =>
    apiRequest(`/api/v1/sales/promotions/${promotionId}/deactivate`, { method: 'POST', token }),
};
