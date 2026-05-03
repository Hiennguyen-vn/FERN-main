import { http } from './http'

export interface StockBalanceView {
  item_id: string
  outlet_id: string
  qty_on_hand: string
  qty_reserved_local: string
  last_movement_at?: string | null
  synced_at?: string | null
}

export interface ProductAvailabilityView {
  product_id: string
  outlet_id: string
  qty_available: number
  tracked_by_recipe: boolean
  basis: 'recipe' | 'product_alias' | 'untracked'
  last_synced_at?: string | null
}

export type WasteReason = 'SPILL' | 'EXPIRED' | 'TEST' | 'DAMAGED' | 'OTHER'

export interface CreateWasteRequest {
  outletId: string
  itemId: string
  quantity: number
  businessDate: string   // yyyy-MM-dd
  unitCost?: number | null
  reason: WasteReason
  note?: string | null
  createdAtDevice?: string
}

export interface WasteView {
  eventId: string
  idempotencyKey: string
  movementType: 'WASTE'
  outletId: string
  itemId: string
  quantity: string
  unit: string
  reason: string
  note: string
  actorUserId: string
  actorUsername: string
  deviceId: string | null
  posSessionId: string
  terminalId: string | null
  registerCode: string | null
  businessDate: string
  createdAtDevice: string
  needsReview: boolean
  syncStatus: 'PENDING' | 'SYNCING' | 'ACKED' | 'FAILED' | 'REJECTED'
  outboxEventId: string | null
  lastError: string | null
  createdAt: string
}

export interface CreateStockInSimpleRequest {
  outletId: string
  itemId: string
  quantity: number
  reason: string
  note: string
  createdAtDevice?: string
}

export interface StockInSimpleView {
  eventId: string
  idempotencyKey: string
  movementType: 'STOCK_IN_SIMPLE'
  outletId: string
  itemId: string
  quantity: string
  unit: string
  reason: string
  note: string
  actorUserId: string
  actorUsername: string
  deviceId: string | null
  posSessionId: string
  terminalId: string | null
  registerCode: string | null
  businessDate: string
  createdAtDevice: string
  needsReview: boolean
  syncStatus: 'PENDING' | 'SYNCING' | 'ACKED' | 'FAILED' | 'REJECTED'
  outboxEventId: string | null
  lastError: string | null
  createdAt: string
}

export interface StockBalanceListView {
  outletId: string
  itemId: string
  itemCode: string
  itemName: string
  baseUomCode: string
  qtyOnHand: string
  unitCost: string | null
}

export interface PagedResult<T> {
  content: T[]
  totalElements: number
  page: number
  size: number
}

function idemHeaders(key?: string) {
  return key ? { headers: { 'Idempotency-Key': key } } : undefined
}

export const inventoryApi = {
  getStockBalance: (outletId: string, itemId: string) =>
    http.get<StockBalanceView>(`/inventory/stock-balances/${itemId}`, {
      params: { outlet_id: outletId },
    }),
  getProductAvailability: (outletId: string, productId: string) =>
    http.get<ProductAvailabilityView>(`/inventory/products/${productId}/availability`, {
      params: { outlet_id: outletId },
    }),
  listStockBalances: (outletId: string) =>
    http.get<PagedResult<StockBalanceListView>>('/inventory/stock-balances', {
      params: { outletId, limit: 500 },
    }),
  createWaste: (body: CreateWasteRequest, idempotencyKey: string) =>
    http.post<WasteView>('/inventory/waste', body, idemHeaders(idempotencyKey)),
  createStockInSimple: (body: CreateStockInSimpleRequest, idempotencyKey: string) =>
    http.post<StockInSimpleView>('/inventory/stock-in-simple', body, idemHeaders(idempotencyKey)),
}
