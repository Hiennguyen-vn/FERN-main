import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArray, decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord, asString } from '@/api/records';

export interface SaleLineItemView {
  productId?: string | null;
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
  status?: string | null;
  paymentStatus?: string | null;
  orderType?: string | null;
  orderingTableCode?: string | null;
  currencyCode?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
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
  status?: string | null;
  outletIds?: string[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  [key: string]: unknown;
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
    productId: number;
    quantity: number;
    discountAmount: number;
    taxAmount: number;
    note: null;
    promotionIds: number[];
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
  managerId: number;
  businessDate: string;
  note?: string | null;
}

function decodeLineItem(value: unknown): SaleLineItemView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    productId: asNullableString(record.productId),
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
    status: asNullableString(record.status),
    paymentStatus: asNullableString(record.paymentStatus),
    orderType: asNullableString(record.orderType),
    orderingTableCode: asNullableString(record.orderingTableCode),
    currencyCode: asNullableString(record.currencyCode),
    subtotal: asNullableNumber(record.subtotal),
    discount: asNullableNumber(record.discount),
    taxAmount: asNullableNumber(record.taxAmount),
    totalAmount: asNullableNumber(record.totalAmount),
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
    status: asNullableString(record.status),
    outletIds: Array.isArray(record.outletIds) ? record.outletIds.map((item) => asId(item)) : [],
    effectiveFrom: asDateOnly(record.effectiveFrom),
    effectiveTo: asDateOnly(record.effectiveTo),
  };
}

export const salesApi = {
  orders: async (token: string, query: SalesOrdersQuery): Promise<PagedResponse<SaleListItemView>> =>
    decodePaged(await apiRequest('/api/v1/sales/orders', { token, query }), decodeSale),
  orderDetail: async (token: string, saleId: string): Promise<SaleDetailView> =>
    decodeSale(await apiRequest(`/api/v1/sales/orders/${saleId}`, { token })),
  createOrder: async (token: string, payload: CreateSalePayload): Promise<SaleDetailView> =>
    decodeSale(await apiRequest('/api/v1/sales/orders', { method: 'POST', token, body: payload })),
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
  createPromotion: async (token: string, payload: unknown): Promise<unknown> =>
    apiRequest('/api/v1/sales/promotions', { method: 'POST', token, body: payload }),
  deactivatePromotion: async (token: string, promotionId: string): Promise<unknown> =>
    apiRequest(`/api/v1/sales/promotions/${promotionId}/deactivate`, { method: 'POST', token }),
};
