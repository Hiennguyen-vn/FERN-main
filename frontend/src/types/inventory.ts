// Inventory types aligned to gateway contracts

export type StockStatus = 'normal' | 'low' | 'out_of_stock' | 'overstock';
export type StockCountStatus = 'draft' | 'counting' | 'posted' | 'cancelled';
export type AdjustmentStatus = 'draft' | 'posted' | 'cancelled';
export type AdjustmentDirection = 'increase' | 'decrease';
export type WasteStatus = 'draft' | 'posted' | 'cancelled';
export type LedgerTransactionType =
  | 'goods_receipt'
  | 'sale_reservation'
  | 'stock_count'
  | 'adjustment'
  | 'waste'
  | 'transfer'
  | 'opening_balance';

export interface StockBalance {
  id: string;
  ingredientId: string;
  ingredientName: string;
  category: string;
  currentQty: number;
  uom: string;
  reorderLevel: number;
  status: StockStatus;
  lastMovement: string;
  lastMovementType: LedgerTransactionType;
  outletId: string;
}

export interface LedgerEntry {
  id: string;
  datetime: string;
  transactionType: LedgerTransactionType;
  ingredientId: string;
  ingredientName: string;
  quantityDelta: number;
  resultingBalance: number;
  uom: string;
  sourceDocument: string;
  sourceType: string;
  actor: string;
  outletId: string;
  notes?: string;
}

export interface StockCountSession {
  id: string;
  code: string;
  outletId: string;
  outletName: string;
  createdBy: string;
  status: StockCountStatus;
  startedAt: string;
  postedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  totalItems: number;
  countedItems: number;
  varianceItems: number;
  varianceValue: number;
}

export interface StockCountLine {
  id: string;
  countSessionId: string;
  ingredientId: string;
  ingredientName: string;
  uom: string;
  systemQty: number;
  actualQty: number | null;
  variance: number;
  category: string;
}

export interface StockAdjustment {
  id: string;
  code: string;
  outletId: string;
  outletName: string;
  createdBy: string;
  createdAt: string;
  postedAt?: string;
  cancelledAt?: string;
  status: AdjustmentStatus;
  lines: AdjustmentLine[];
  notes?: string;
}

export interface AdjustmentLine {
  id: string;
  ingredientId: string;
  ingredientName: string;
  uom: string;
  direction: AdjustmentDirection;
  quantity: number;
  reason: string;
  note?: string;
}

export interface WasteRecord {
  id: string;
  code: string;
  outletId: string;
  outletName: string;
  ingredientId: string;
  ingredientName: string;
  uom: string;
  quantity: number;
  reason: string;
  recordedBy: string;
  recordedAt: string;
  status: WasteStatus;
  postedAt?: string;
  stockImpact?: number;
}
