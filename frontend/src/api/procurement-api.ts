import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArray, decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord, asString } from '@/api/records';

export interface SupplierView {
  id: string;
  supplierCode?: string | null;
  name?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface PurchaseOrderView {
  id: string;
  poNumber?: string | null;
  supplierId?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  currencyCode?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export interface GoodsReceiptView {
  id: string;
  receiptNumber?: string | null;
  poId?: string | null;
  supplierId?: string | null;
  outletId?: string | null;
  status?: string | null;
  totalPrice?: number | null;
  currencyCode?: string | null;
  businessDate?: string | null;
  items?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SupplierInvoiceView {
  id: string;
  invoiceNumber?: string | null;
  supplierId?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  currencyCode?: string | null;
  invoiceDate?: string | null;
  approvedAt?: string | null;
  linkedReceiptIds?: string[];
  [key: string]: unknown;
}

export interface SupplierPaymentView {
  id: string;
  paymentNumber?: string | null;
  supplierId?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  currencyCode?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export interface SuppliersQuery {
  q?: string;
  status?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ProcurementListQuery {
  outletId?: string;
  supplierId?: string;
  status?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CreateSupplierPayload {
  supplierCode: string;
  name: string;
  legalName?: string;
  contactName?: string;
  phone?: string | null;
  email?: string | null;
  status?: string;
  paymentTerms?: string;
}

function decodeSupplier(value: unknown): SupplierView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    supplierCode: asNullableString(record.supplierCode),
    name: asNullableString(record.name),
    contactName: asNullableString(record.contactName),
    phone: asNullableString(record.phone),
    email: asNullableString(record.email),
    status: asNullableString(record.status),
  };
}

function decodePurchaseOrder(value: unknown): PurchaseOrderView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    poNumber: asNullableString(record.poNumber),
    supplierId: asNullableString(record.supplierId),
    status: asNullableString(record.status),
    totalAmount: asNullableNumber(record.totalAmount),
    currencyCode: asNullableString(record.currencyCode),
    createdAt: asNullableString(record.createdAt),
  };
}

function decodeGoodsReceipt(value: unknown): GoodsReceiptView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    receiptNumber: asNullableString(record.receiptNumber),
    poId: asNullableString(record.poId),
    supplierId: asNullableString(record.supplierId),
    outletId: asNullableString(record.outletId),
    status: asNullableString(record.status),
    totalPrice: asNullableNumber(record.totalPrice),
    currencyCode: asNullableString(record.currencyCode),
    businessDate: asDateOnly(record.businessDate),
    items: Array.isArray(record.items) ? record.items.map((item) => asRecord(item) ?? {}) : [],
  };
}

function decodeSupplierInvoice(value: unknown): SupplierInvoiceView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    invoiceNumber: asNullableString(record.invoiceNumber),
    supplierId: asNullableString(record.supplierId),
    status: asNullableString(record.status),
    totalAmount: asNullableNumber(record.totalAmount),
    currencyCode: asNullableString(record.currencyCode),
    invoiceDate: asDateOnly(record.invoiceDate),
    approvedAt: asNullableString(record.approvedAt),
    linkedReceiptIds: Array.isArray(record.linkedReceiptIds) ? record.linkedReceiptIds.map((item) => asId(item)) : [],
  };
}

function decodeSupplierPayment(value: unknown): SupplierPaymentView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    paymentNumber: asNullableString(record.paymentNumber),
    supplierId: asNullableString(record.supplierId),
    status: asNullableString(record.status),
    totalAmount: asNullableNumber(record.totalAmount),
    currencyCode: asNullableString(record.currencyCode),
    createdAt: asNullableString(record.createdAt),
  };
}

export const procurementApi = {
  suppliers: async (token: string): Promise<SupplierView[]> =>
    decodeArray(await apiRequest('/api/v1/procurement/suppliers', { token }), decodeSupplier),
  suppliersPaged: async (token: string, query: SuppliersQuery): Promise<PagedResponse<SupplierView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/suppliers', { token, query }), decodeSupplier),
  purchaseOrders: async (token: string, query: ProcurementListQuery): Promise<PagedResponse<PurchaseOrderView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/purchase-orders', { token, query }), decodePurchaseOrder),
  goodsReceipts: async (token: string, query: ProcurementListQuery): Promise<PagedResponse<GoodsReceiptView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/goods-receipts', { token, query }), decodeGoodsReceipt),
  invoices: async (token: string, query: ProcurementListQuery): Promise<PagedResponse<SupplierInvoiceView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/invoices', { token, query }), decodeSupplierInvoice),
  payments: async (token: string, query: ProcurementListQuery): Promise<PagedResponse<SupplierPaymentView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/payments', { token, query }), decodeSupplierPayment),
  createSupplier: async (token: string, payload: CreateSupplierPayload): Promise<unknown> =>
    apiRequest('/api/v1/procurement/suppliers', { method: 'POST', token, body: payload }),
  createPurchaseOrder: async (token: string, payload: unknown): Promise<unknown> =>
    apiRequest('/api/v1/procurement/purchase-orders', { method: 'POST', token, body: payload }),
  createGoodsReceipt: async (token: string, payload: unknown): Promise<unknown> =>
    apiRequest('/api/v1/procurement/goods-receipts', { method: 'POST', token, body: payload }),
  createInvoice: async (token: string, payload: unknown): Promise<unknown> =>
    apiRequest('/api/v1/procurement/invoices', { method: 'POST', token, body: payload }),
  createPayment: async (token: string, payload: unknown): Promise<unknown> =>
    apiRequest('/api/v1/procurement/payments', { method: 'POST', token, body: payload }),
  approvePurchaseOrder: async (token: string, purchaseOrderId: string): Promise<unknown> =>
    apiRequest(`/api/v1/procurement/purchase-orders/${purchaseOrderId}/approve`, { method: 'POST', token }),
  approveGoodsReceipt: async (token: string, receiptId: string): Promise<unknown> =>
    apiRequest(`/api/v1/procurement/goods-receipts/${receiptId}/approve`, { method: 'POST', token }),
  postGoodsReceipt: async (token: string, receiptId: string): Promise<unknown> =>
    apiRequest(`/api/v1/procurement/goods-receipts/${receiptId}/post`, { method: 'POST', token }),
  approveInvoice: async (token: string, invoiceId: string): Promise<unknown> =>
    apiRequest(`/api/v1/procurement/invoices/${invoiceId}/approve`, { method: 'POST', token }),
  postPayment: async (token: string, paymentId: string): Promise<unknown> =>
    apiRequest(`/api/v1/procurement/payments/${paymentId}/post`, { method: 'POST', token }),
  cancelPayment: async (token: string, paymentId: string): Promise<unknown> =>
    apiRequest(`/api/v1/procurement/payments/${paymentId}/cancel`, { method: 'POST', token }),
  reversePayment: async (token: string, paymentId: string): Promise<unknown> =>
    apiRequest(`/api/v1/procurement/payments/${paymentId}/reverse`, { method: 'POST', token }),
};

