import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArrayFromPageOrArray, decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord, asString } from '@/api/records';

export interface PurchaseOrderItemView {
  itemId?: string | null;
  uomCode?: string | null;
  expectedUnitPrice?: number | null;
  qtyOrdered?: number | null;
  qtyReceived?: number | null;
  status?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

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
  outletId?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  expectedTotal?: number | null;
  currencyCode?: string | null;
  orderDate?: string | null;
  expectedDeliveryDate?: string | null;
  note?: string | null;
  createdAt?: string | null;
  items?: PurchaseOrderItemView[];
  approvedAt?: string | null;
  [key: string]: unknown;
}

export interface GoodsReceiptItemView {
  id: string;
  itemId?: string | null;
  uomCode?: string | null;
  qtyReceived?: number | null;
  unitCost?: number | null;
  lineTotal?: number | null;
  manufactureDate?: string | null;
  expiryDate?: string | null;
  note?: string | null;
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
  receiptTime?: string | null;
  note?: string | null;
  supplierLotNumber?: string | null;
  approvedAt?: string | null;
  items?: GoodsReceiptItemView[];
  [key: string]: unknown;
}

export interface SupplierInvoiceItemView {
  lineNumber?: number | null;
  lineType?: string | null;
  goodsReceiptItemId?: string | null;
  description?: string | null;
  qtyInvoiced?: number | null;
  unitPrice?: number | null;
  taxPercent?: number | null;
  taxAmount?: number | null;
  lineTotal?: number | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface SupplierInvoiceView {
  id: string;
  invoiceNumber?: string | null;
  supplierId?: string | null;
  outletId?: string | null;
  status?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  currencyCode?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  note?: string | null;
  approvedAt?: string | null;
  linkedReceiptIds?: string[];
  items?: SupplierInvoiceItemView[];
  [key: string]: unknown;
}

export interface SupplierPaymentView {
  id: string;
  paymentNumber?: string | null;
  supplierId?: string | null;
  outletId?: string | null;
  paymentMethod?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  amount?: number | null;
  currencyCode?: string | null;
  paymentTime?: string | null;
  transactionRef?: string | null;
  note?: string | null;
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
    outletId: asNullableString(record.outletId),
    status: asNullableString(record.status),
    totalAmount: asNullableNumber(record.totalAmount ?? record.expectedTotal),
    expectedTotal: asNullableNumber(record.expectedTotal ?? record.totalAmount),
    currencyCode: asNullableString(record.currencyCode),
    orderDate: asDateOnly(record.orderDate),
    expectedDeliveryDate: asDateOnly(record.expectedDeliveryDate),
    note: asNullableString(record.note),
    createdAt: asNullableString(record.createdAt),
    approvedAt: asNullableString(record.approvedAt),
    items: Array.isArray(record.items) ? record.items.map((item) => decodePurchaseOrderItem(item)) : [],
  };
}

function decodePurchaseOrderItem(value: unknown): PurchaseOrderItemView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    itemId: asNullableString(record.itemId),
    uomCode: asNullableString(record.uomCode),
    expectedUnitPrice: asNullableNumber(record.expectedUnitPrice),
    qtyOrdered: asNullableNumber(record.qtyOrdered),
    qtyReceived: asNullableNumber(record.qtyReceived),
    status: asNullableString(record.status),
    note: asNullableString(record.note),
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
    receiptTime: asNullableString(record.receiptTime),
    note: asNullableString(record.note),
    supplierLotNumber: asNullableString(record.supplierLotNumber),
    approvedAt: asNullableString(record.approvedAt),
    items: Array.isArray(record.items) ? record.items.map((item) => decodeGoodsReceiptItem(item)) : [],
  };
}

function decodeGoodsReceiptItem(value: unknown): GoodsReceiptItemView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    itemId: asNullableString(record.itemId),
    uomCode: asNullableString(record.uomCode),
    qtyReceived: asNullableNumber(record.qtyReceived),
    unitCost: asNullableNumber(record.unitCost),
    lineTotal: asNullableNumber(record.lineTotal),
    manufactureDate: asDateOnly(record.manufactureDate),
    expiryDate: asDateOnly(record.expiryDate),
    note: asNullableString(record.note),
  };
}

function decodeSupplierInvoice(value: unknown): SupplierInvoiceView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    invoiceNumber: asNullableString(record.invoiceNumber),
    supplierId: asNullableString(record.supplierId),
    outletId: asNullableString(record.outletId),
    status: asNullableString(record.status),
    subtotal: asNullableNumber(record.subtotal),
    taxAmount: asNullableNumber(record.taxAmount),
    totalAmount: asNullableNumber(record.totalAmount),
    currencyCode: asNullableString(record.currencyCode),
    invoiceDate: asDateOnly(record.invoiceDate),
    dueDate: asDateOnly(record.dueDate),
    note: asNullableString(record.note),
    approvedAt: asNullableString(record.approvedAt),
    linkedReceiptIds: Array.isArray(record.linkedReceiptIds) ? record.linkedReceiptIds.map((item) => asId(item)) : [],
    items: Array.isArray(record.items) ? record.items.map((item) => decodeSupplierInvoiceItem(item)) : [],
  };
}

function decodeSupplierInvoiceItem(value: unknown): SupplierInvoiceItemView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    lineNumber: asNullableNumber(record.lineNumber),
    lineType: asNullableString(record.lineType),
    goodsReceiptItemId: asNullableString(record.goodsReceiptItemId),
    description: asNullableString(record.description),
    qtyInvoiced: asNullableNumber(record.qtyInvoiced),
    unitPrice: asNullableNumber(record.unitPrice),
    taxPercent: asNullableNumber(record.taxPercent),
    taxAmount: asNullableNumber(record.taxAmount),
    lineTotal: asNullableNumber(record.lineTotal),
    note: asNullableString(record.note),
  };
}

function decodeSupplierPayment(value: unknown): SupplierPaymentView {
  const record = asRecord(value) ?? {};
  const amount = asNullableNumber(record.amount ?? record.totalAmount);
  return {
    ...record,
    id: asId(record.id),
    paymentNumber: asNullableString(record.paymentNumber ?? record.transactionRef),
    supplierId: asNullableString(record.supplierId),
    outletId: asNullableString(record.outletId),
    paymentMethod: asNullableString(record.paymentMethod),
    status: asNullableString(record.status),
    totalAmount: amount,
    amount,
    currencyCode: asNullableString(record.currencyCode),
    paymentTime: asNullableString(record.paymentTime),
    transactionRef: asNullableString(record.transactionRef),
    note: asNullableString(record.note),
    createdAt: asNullableString(record.createdAt),
  };
}

export const procurementApi = {
  suppliers: async (token: string): Promise<SupplierView[]> =>
    decodeArrayFromPageOrArray(await apiRequest('/api/v1/procurement/suppliers', { token }), decodeSupplier),
  suppliersPaged: async (token: string, query: SuppliersQuery): Promise<PagedResponse<SupplierView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/suppliers', { token, query }), decodeSupplier),
  purchaseOrders: async (token: string, query: ProcurementListQuery): Promise<PagedResponse<PurchaseOrderView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/purchase-orders', { token, query }), decodePurchaseOrder),
  purchaseOrder: async (token: string, purchaseOrderId: string): Promise<PurchaseOrderView> =>
    decodePurchaseOrder(await apiRequest(`/api/v1/procurement/purchase-orders/${purchaseOrderId}`, { token })),
  goodsReceipts: async (token: string, query: ProcurementListQuery): Promise<PagedResponse<GoodsReceiptView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/goods-receipts', { token, query }), decodeGoodsReceipt),
  goodsReceipt: async (token: string, receiptId: string): Promise<GoodsReceiptView> =>
    decodeGoodsReceipt(await apiRequest(`/api/v1/procurement/goods-receipts/${receiptId}`, { token })),
  invoices: async (token: string, query: ProcurementListQuery): Promise<PagedResponse<SupplierInvoiceView>> =>
    decodePaged(await apiRequest('/api/v1/procurement/invoices', { token, query }), decodeSupplierInvoice),
  invoice: async (token: string, invoiceId: string): Promise<SupplierInvoiceView> =>
    decodeSupplierInvoice(await apiRequest(`/api/v1/procurement/invoices/${invoiceId}`, { token })),
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
