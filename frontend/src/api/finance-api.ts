import { apiRequest, type PagedResponse } from '@/api/client';
import { decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord } from '@/api/records';

export interface ExpenseView {
  id: string;
  outletId?: string | null;
  businessDate?: string | null;
  currencyCode?: string | null;
  amount?: number | null;
  sourceType?: string | null;
  subtype?: string | null;
  description?: string | null;
  note?: string | null;
  createdByUserId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface ExpenseDocumentView {
  id: string;
  expenseId: string;
  documentType?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  objectKey?: string | null;
  url?: string | null;
  createdByUserId?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export interface SupplierInvoiceExpenseLineView {
  lineNumber: number;
  lineType?: string | null;
  goodsReceiptItemId?: string | null;
  itemId?: string | null;
  itemCode?: string | null;
  itemName?: string | null;
  uomCode?: string | null;
  qtyInvoiced?: number | null;
  unitPrice?: number | null;
  taxPercent?: number | null;
  taxAmount?: number | null;
  lineTotal?: number | null;
  qtyReceived?: number | null;
  receiptUnitCost?: number | null;
  receiptLineTotal?: number | null;
  description?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface SupplierInvoiceExpenseDetailView {
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  supplierId?: string | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  currencyCode?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  status?: string | null;
  note?: string | null;
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  goodsReceiptId?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrderStatus?: string | null;
  receiptStatus?: string | null;
  receiptTime?: string | null;
  receiptBusinessDate?: string | null;
  receiptTotal?: number | null;
  supplierLotNumber?: string | null;
  lines: SupplierInvoiceExpenseLineView[];
  [key: string]: unknown;
}

export interface InventoryReceiptExpenseLineView {
  goodsReceiptItemId?: string | null;
  itemId?: string | null;
  itemCode?: string | null;
  itemName?: string | null;
  uomCode?: string | null;
  qtyReceived?: number | null;
  unitCost?: number | null;
  lineTotal?: number | null;
  manufactureDate?: string | null;
  expiryDate?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface InventoryReceiptExpenseDetailView {
  goodsReceiptId?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrderStatus?: string | null;
  supplierId?: string | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  currencyCode?: string | null;
  receiptStatus?: string | null;
  receiptTime?: string | null;
  receiptBusinessDate?: string | null;
  receiptTotal?: number | null;
  supplierLotNumber?: string | null;
  lines: InventoryReceiptExpenseLineView[];
  [key: string]: unknown;
}

export interface ExpenseDetailView {
  expense: ExpenseView;
  documents: ExpenseDocumentView[];
  supplierInvoice?: SupplierInvoiceExpenseDetailView | null;
  supplierInvoices: SupplierInvoiceExpenseDetailView[];
  inventoryReceipt?: InventoryReceiptExpenseDetailView | null;
}

export interface FinanceExpensesQuery {
  outletId?: string;
  sourceType?: string;
  startDate?: string;
  endDate?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ExpenseSummaryRow {
  sourceType: string;
  recordCount: number;
  amount: number;
  currencyCode?: string | null;
}

export interface CreateExpensePayload {
  outletId: string | number;
  businessDate: string;
  currencyCode: string;
  amount: number;
  description: string;
  note?: string | null;
}

function decodeExpense(value: unknown): ExpenseView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    businessDate: asDateOnly(record.businessDate),
    currencyCode: asNullableString(record.currencyCode),
    amount: asNullableNumber(record.amount),
    sourceType: asNullableString(record.sourceType),
    subtype: asNullableString(record.subtype),
    description: asNullableString(record.description),
    note: asNullableString(record.note),
    createdByUserId: asNullableString(record.createdByUserId),
    createdAt: asNullableString(record.createdAt),
    updatedAt: asNullableString(record.updatedAt),
  };
}

function decodeExpenseDocument(value: unknown): ExpenseDocumentView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    expenseId: asId(record.expenseId),
    documentType: asNullableString(record.documentType),
    fileName: asNullableString(record.fileName),
    contentType: asNullableString(record.contentType),
    objectKey: asNullableString(record.objectKey),
    url: asNullableString(record.url),
    createdByUserId: asNullableString(record.createdByUserId),
    createdAt: asNullableString(record.createdAt),
  };
}

function decodeSupplierInvoiceExpenseLine(value: unknown): SupplierInvoiceExpenseLineView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    lineNumber: Number(record.lineNumber ?? 0),
    lineType: asNullableString(record.lineType),
    goodsReceiptItemId: asId(record.goodsReceiptItemId),
    itemId: asId(record.itemId),
    itemCode: asNullableString(record.itemCode),
    itemName: asNullableString(record.itemName),
    uomCode: asNullableString(record.uomCode),
    qtyInvoiced: asNullableNumber(record.qtyInvoiced),
    unitPrice: asNullableNumber(record.unitPrice),
    taxPercent: asNullableNumber(record.taxPercent),
    taxAmount: asNullableNumber(record.taxAmount),
    lineTotal: asNullableNumber(record.lineTotal),
    qtyReceived: asNullableNumber(record.qtyReceived),
    receiptUnitCost: asNullableNumber(record.receiptUnitCost),
    receiptLineTotal: asNullableNumber(record.receiptLineTotal),
    description: asNullableString(record.description),
    note: asNullableString(record.note),
  };
}

function decodeSupplierInvoiceExpenseDetail(value: unknown): SupplierInvoiceExpenseDetailView | null {
  const record = asRecord(value);
  if (!record) return null;
  const lines = Array.isArray(record.lines)
    ? record.lines.map(decodeSupplierInvoiceExpenseLine)
    : [];
  return {
    ...record,
    invoiceId: asId(record.invoiceId),
    invoiceNumber: asNullableString(record.invoiceNumber),
    supplierId: asId(record.supplierId),
    supplierCode: asNullableString(record.supplierCode),
    supplierName: asNullableString(record.supplierName),
    currencyCode: asNullableString(record.currencyCode),
    invoiceDate: asDateOnly(record.invoiceDate),
    dueDate: asDateOnly(record.dueDate),
    subtotal: asNullableNumber(record.subtotal),
    taxAmount: asNullableNumber(record.taxAmount),
    totalAmount: asNullableNumber(record.totalAmount),
    status: asNullableString(record.status),
    note: asNullableString(record.note),
    createdByUserId: asId(record.createdByUserId),
    approvedByUserId: asId(record.approvedByUserId),
    approvedAt: asNullableString(record.approvedAt),
    createdAt: asNullableString(record.createdAt),
    updatedAt: asNullableString(record.updatedAt),
    goodsReceiptId: asId(record.goodsReceiptId),
    purchaseOrderId: asId(record.purchaseOrderId),
    purchaseOrderStatus: asNullableString(record.purchaseOrderStatus),
    receiptStatus: asNullableString(record.receiptStatus),
    receiptTime: asNullableString(record.receiptTime),
    receiptBusinessDate: asDateOnly(record.receiptBusinessDate),
    receiptTotal: asNullableNumber(record.receiptTotal),
    supplierLotNumber: asNullableString(record.supplierLotNumber),
    lines,
  };
}

function decodeInventoryReceiptExpenseLine(value: unknown): InventoryReceiptExpenseLineView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    goodsReceiptItemId: asId(record.goodsReceiptItemId),
    itemId: asId(record.itemId),
    itemCode: asNullableString(record.itemCode),
    itemName: asNullableString(record.itemName),
    uomCode: asNullableString(record.uomCode),
    qtyReceived: asNullableNumber(record.qtyReceived),
    unitCost: asNullableNumber(record.unitCost),
    lineTotal: asNullableNumber(record.lineTotal),
    manufactureDate: asDateOnly(record.manufactureDate),
    expiryDate: asDateOnly(record.expiryDate),
    note: asNullableString(record.note),
  };
}

function decodeInventoryReceiptExpenseDetail(value: unknown): InventoryReceiptExpenseDetailView | null {
  const record = asRecord(value);
  if (!record) return null;
  const lines = Array.isArray(record.lines)
    ? record.lines.map(decodeInventoryReceiptExpenseLine)
    : [];
  return {
    ...record,
    goodsReceiptId: asId(record.goodsReceiptId),
    purchaseOrderId: asId(record.purchaseOrderId),
    purchaseOrderStatus: asNullableString(record.purchaseOrderStatus),
    supplierId: asId(record.supplierId),
    supplierCode: asNullableString(record.supplierCode),
    supplierName: asNullableString(record.supplierName),
    currencyCode: asNullableString(record.currencyCode),
    receiptStatus: asNullableString(record.receiptStatus),
    receiptTime: asNullableString(record.receiptTime),
    receiptBusinessDate: asDateOnly(record.receiptBusinessDate),
    receiptTotal: asNullableNumber(record.receiptTotal),
    supplierLotNumber: asNullableString(record.supplierLotNumber),
    lines,
  };
}

function decodeExpenseDetail(value: unknown): ExpenseDetailView {
  const record = asRecord(value) ?? {};
  const documents = Array.isArray(record.documents)
    ? record.documents.map(decodeExpenseDocument)
    : [];
  const supplierInvoices = Array.isArray(record.supplierInvoices)
    ? record.supplierInvoices
        .map(decodeSupplierInvoiceExpenseDetail)
        .filter((item): item is SupplierInvoiceExpenseDetailView => item !== null)
    : [];
  return {
    expense: decodeExpense(record.expense),
    documents,
    supplierInvoice: decodeSupplierInvoiceExpenseDetail(record.supplierInvoice) ?? supplierInvoices[0] ?? null,
    supplierInvoices,
    inventoryReceipt: decodeInventoryReceiptExpenseDetail(record.inventoryReceipt),
  };
}

function decodeExpenseSummaryRow(value: unknown): ExpenseSummaryRow {
  const record = asRecord(value) ?? {};
  return {
    sourceType: String(record.sourceType ?? ''),
    recordCount: Number(record.recordCount ?? 0),
    amount: Number(record.amount ?? 0),
    currencyCode: asNullableString(record.currencyCode),
  };
}

export interface MonthlyExpenseRow {
  outletId: string | number;
  month: string;
  sourceType: string;
  recordCount: number;
  amount: number;
  currencyCode?: string | null;
}

export const financeApi = {
  expenses: async (token: string, query: FinanceExpensesQuery): Promise<PagedResponse<ExpenseView>> =>
    decodePaged(await apiRequest('/api/v1/finance/expenses', { token, query }), decodeExpense),
  expenseSummary: async (token: string, query: Omit<FinanceExpensesQuery, 'sortBy' | 'sortDir' | 'limit' | 'offset'>): Promise<ExpenseSummaryRow[]> => {
    const raw = await apiRequest<unknown>('/api/v1/finance/expenses/summary', { token, query });
    return Array.isArray(raw) ? raw.map(decodeExpenseSummaryRow) : [];
  },
  monthlyExpenses: async (
    token: string,
    query: { outletId?: string; startDate?: string; endDate?: string },
  ): Promise<MonthlyExpenseRow[]> => {
    const raw = await apiRequest<unknown>('/api/v1/finance/expenses/monthly', { token, query });
    return Array.isArray(raw) ? (raw as MonthlyExpenseRow[]) : [];
  },
  expenseDetail: async (token: string, expenseId: string): Promise<ExpenseDetailView> =>
    decodeExpenseDetail(await apiRequest(`/api/v1/finance/expenses/${expenseId}/detail`, { token })),
  createOperatingExpense: async (token: string, payload: CreateExpensePayload): Promise<unknown> =>
    apiRequest('/api/v1/finance/expenses/operating', { method: 'POST', token, body: payload }),
  createOtherExpense: async (token: string, payload: CreateExpensePayload): Promise<unknown> =>
    apiRequest('/api/v1/finance/expenses/other', { method: 'POST', token, body: payload }),
};
