import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArray, decodeArrayFromPageOrArray, decodePaged } from '@/api/decoders';
import {
  asDateOnly,
  asId,
  asNullableNumber,
  asNullableString,
  asRecord,
  asRecordArray,
} from '@/api/records';

export interface StockBalanceView {
  outletId?: string | null;
  itemId?: string | null;
  qtyOnHand?: number | null;
  unitCost?: number | null;
  unitCode?: string | null;
  categoryCode?: string | null;
  itemName?: string | null;
  lastCountDate?: string | null;
  [key: string]: unknown;
}

export interface InventoryTransactionView {
  id: string;
  outletId?: string | null;
  itemId?: string | null;
  txnType?: string | null;
  qtyDelta?: number | null;
  qtyChange?: number | null;
  businessDate?: string | null;
  txnTime?: string | null;
  createdAt?: string | null;
  wasteReason?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface StockCountSessionView {
  id: string;
  outletId?: string | null;
  status?: string | null;
  businessDate?: string | null;
  countDate?: string | null;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  totalItems?: number | null;
  countedItems?: number | null;
  varianceItems?: number | null;
  varianceValue?: number | null;
  lines?: StockCountLineView[];
  [key: string]: unknown;
}

export interface StockCountLineView {
  id?: string | null;
  itemId?: string | null;
  systemQty?: number | null;
  actualQty?: number | null;
  varianceQty?: number | null;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface InventoryBalancesQuery {
  outletId: string;
  lowOnly?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  q?: string;
  limit?: number;
  offset?: number;
}

export interface InventoryTransactionsQuery {
  outletId: string;
  itemId?: string;
  dateFrom?: string;
  dateTo?: string;
  txnType?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  q?: string;
  limit?: number;
  offset?: number;
}

export interface StockCountSessionsQuery {
  outletId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  q?: string;
  limit?: number;
  offset?: number;
}

export interface CreateWastePayload {
  outletId: string | number;
  itemId: string | number;
  qty?: number;
  quantity?: number;
  businessDate?: string | null;
  reason?: string | null;
  note?: string | null;
}

export interface CreateStockCountSessionPayload {
  outletId: string | number;
  businessDate?: string;
  countDate?: string;
  note?: string | null;
  lines?: Array<{
    itemId: string | number;
    actualQty: number;
    note?: string | null;
  }>;
}

function decodeStockBalance(value: unknown): StockBalanceView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    outletId: asNullableString(record.outletId),
    itemId: asNullableString(record.itemId),
    qtyOnHand: asNullableNumber(record.qtyOnHand),
    unitCost: asNullableNumber(record.unitCost),
    unitCode: asNullableString(record.unitCode ?? record.baseUomCode),
    categoryCode: asNullableString(record.categoryCode),
    itemName: asNullableString(record.itemName ?? record.name),
    lastCountDate: asDateOnly(record.lastCountDate),
  };
}

function decodeInventoryTransaction(value: unknown): InventoryTransactionView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    itemId: asNullableString(record.itemId),
    txnType: asNullableString(record.txnType),
    qtyDelta: asNullableNumber(record.qtyDelta),
    qtyChange: asNullableNumber(record.qtyChange ?? record.qtyDelta),
    businessDate: asDateOnly(record.businessDate),
    txnTime: asNullableString(record.txnTime),
    createdAt: asNullableString(record.createdAt),
    wasteReason: asNullableString(record.wasteReason),
    note: asNullableString(record.note),
  };
}

function decodeStockCountSession(value: unknown): StockCountSessionView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    status: asNullableString(record.status),
    businessDate: asDateOnly(record.businessDate),
    countDate: asDateOnly(record.countDate ?? record.businessDate),
    note: asNullableString(record.note),
    createdAt: asNullableString(record.createdAt),
    updatedAt: asNullableString(record.updatedAt),
    totalItems: asNullableNumber(record.totalItems),
    countedItems: asNullableNumber(record.countedItems),
    varianceItems: asNullableNumber(record.varianceItems),
    varianceValue: asNullableNumber(record.varianceValue),
    lines: asRecordArray(record.lines).map((line) => ({
      ...line,
      id: asNullableString(line.id),
      itemId: asNullableString(line.itemId),
      systemQty: asNullableNumber(line.systemQty),
      actualQty: asNullableNumber(line.actualQty),
      varianceQty: asNullableNumber(line.varianceQty),
      note: asNullableString(line.note),
      createdAt: asNullableString(line.createdAt),
      updatedAt: asNullableString(line.updatedAt),
    })),
  };
}

async function listAllBalances(token: string, outletId: string, lowOnly = false): Promise<StockBalanceView[]> {
  const limit = 200;
  let offset = 0;
  const items: StockBalanceView[] = [];

  while (true) {
    const page = decodePaged(
      await apiRequest('/api/v1/inventory/stock-balances', {
        token,
        query: { outletId, lowOnly: lowOnly || undefined, limit, offset },
      }),
      decodeStockBalance,
    );
    items.push(...page.items);
    if (!page.hasMore || page.items.length === 0) {
      return items;
    }
    offset += page.items.length;
  }
}

export const inventoryApi = {
  balances: async (token: string, outletId: string, lowOnly = false): Promise<StockBalanceView[]> =>
    listAllBalances(token, outletId, lowOnly),
  balancesPage: async (token: string, query: InventoryBalancesQuery): Promise<PagedResponse<StockBalanceView>> =>
    decodePaged(await apiRequest('/api/v1/inventory/stock-balances', { token, query }), decodeStockBalance),
  balanceDetail: async (token: string, outletId: string, itemId: string): Promise<StockBalanceView> =>
    decodeStockBalance(await apiRequest(`/api/v1/inventory/stock-balances/${outletId}/${itemId}`, { token })),
  transactions: async (token: string, query: InventoryTransactionsQuery): Promise<PagedResponse<InventoryTransactionView>> =>
    decodePaged(await apiRequest('/api/v1/inventory/transactions', { token, query }), decodeInventoryTransaction),
  createWaste: async (token: string, payload: CreateWastePayload): Promise<unknown> =>
    apiRequest('/api/v1/inventory/waste', {
      method: 'POST',
      token,
      body: {
        ...(() => {
          const { qty: _qty, quantity: _quantity, ...rest } = payload;
          return rest;
        })(),
        quantity: payload.quantity ?? payload.qty ?? 0,
      },
    }),
  createStockCountSession: async (token: string, payload: CreateStockCountSessionPayload): Promise<unknown> =>
    apiRequest('/api/v1/inventory/stock-count-sessions', {
      method: 'POST',
      token,
      body: {
        ...(() => {
          const { businessDate: _businessDate, ...rest } = payload;
          return rest;
        })(),
        countDate: payload.countDate ?? payload.businessDate,
      },
    }),
  stockCountSessions: async (token: string, query: StockCountSessionsQuery): Promise<PagedResponse<StockCountSessionView>> =>
    decodePaged(await apiRequest('/api/v1/inventory/stock-count-sessions', { token, query }), decodeStockCountSession),
  getStockCountSession: async (token: string, sessionId: string): Promise<StockCountSessionView> =>
    decodeStockCountSession(await apiRequest(`/api/v1/inventory/stock-count-sessions/${sessionId}`, { token })),
  postStockCountSession: async (token: string, sessionId: string): Promise<unknown> =>
    apiRequest(`/api/v1/inventory/stock-count-sessions/${sessionId}/post`, { method: 'POST', token }),
  listStockLots: (token: string, params: { itemId?: number | string; locationId?: number | string; status?: string; limit?: number; offset?: number }): Promise<StockLotView[]> =>
    apiRequest('/api/v1/inventory/stock-lots', { token, query: params }) as Promise<StockLotView[]>,
  createStockLotRecord: (token: string, body: CreateStockLotPayload): Promise<StockLotView> =>
    apiRequest('/api/v1/inventory/stock-lots', { method: 'POST', token, body }) as Promise<StockLotView>,
};

export interface StockLotView {
  id: string;
  itemId: string;
  locationId: string;
  batchNo: string | null;
  lotCode: string | null;
  receivedAt: string;
  expiresAt: string | null;
  qtyReceived: number;
  qtyRemaining: number;
  unitCost: number;
  supplierId: string | null;
  goodsReceiptId: string | null;
  status: 'ACTIVE' | 'DEPLETED' | 'EXPIRED' | 'RECALLED';
  notes: string | null;
  createdAt: string;
}

export interface CreateStockLotPayload {
  itemId: number | string;
  locationId: number | string;
  batchNo?: string | null;
  lotCode?: string | null;
  expiresAt?: string | null;
  qtyReceived: number;
  unitCost?: number;
  supplierId?: number | string | null;
  goodsReceiptId?: number | string | null;
  notes?: string | null;
}
