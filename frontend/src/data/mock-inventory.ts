import type {
  StockBalance, LedgerEntry, StockCountSession, StockCountLine,
  StockAdjustment, WasteRecord,
} from '@/types/inventory';

export const mockStockBalances: StockBalance[] = [
  { id: 'sb-01', ingredientId: 'ing-01', ingredientName: 'Salmon Fillet', category: 'Proteins', currentQty: 12, uom: 'kg', reorderLevel: 15, status: 'low', lastMovement: '2026-04-04T14:30:00', lastMovementType: 'sale_reservation', outletId: 'outlet-001' },
  { id: 'sb-02', ingredientId: 'ing-02', ingredientName: 'Beef Patty', category: 'Proteins', currentQty: 48, uom: 'pcs', reorderLevel: 20, status: 'normal', lastMovement: '2026-04-04T14:15:00', lastMovementType: 'sale_reservation', outletId: 'outlet-001' },
  { id: 'sb-03', ingredientId: 'ing-03', ingredientName: 'Pizza Dough', category: 'Bakery', currentQty: 24, uom: 'pcs', reorderLevel: 10, status: 'normal', lastMovement: '2026-04-04T13:45:00', lastMovementType: 'goods_receipt', outletId: 'outlet-001' },
  { id: 'sb-04', ingredientId: 'ing-04', ingredientName: 'Mozzarella Cheese', category: 'Dairy', currentQty: 3, uom: 'kg', reorderLevel: 8, status: 'low', lastMovement: '2026-04-04T12:00:00', lastMovementType: 'sale_reservation', outletId: 'outlet-001' },
  { id: 'sb-05', ingredientId: 'ing-05', ingredientName: 'Mixed Lettuce', category: 'Produce', currentQty: 0, uom: 'kg', reorderLevel: 5, status: 'out_of_stock', lastMovement: '2026-04-04T11:30:00', lastMovementType: 'waste', outletId: 'outlet-001' },
  { id: 'sb-06', ingredientId: 'ing-06', ingredientName: 'Olive Oil', category: 'Pantry', currentQty: 6, uom: 'L', reorderLevel: 3, status: 'normal', lastMovement: '2026-04-03T22:00:00', lastMovementType: 'goods_receipt', outletId: 'outlet-001' },
  { id: 'sb-07', ingredientId: 'ing-07', ingredientName: 'Espresso Beans', category: 'Beverages', currentQty: 8, uom: 'kg', reorderLevel: 5, status: 'normal', lastMovement: '2026-04-04T08:00:00', lastMovementType: 'goods_receipt', outletId: 'outlet-001' },
  { id: 'sb-08', ingredientId: 'ing-08', ingredientName: 'Chicken Breast', category: 'Proteins', currentQty: 2, uom: 'kg', reorderLevel: 10, status: 'low', lastMovement: '2026-04-04T13:20:00', lastMovementType: 'sale_reservation', outletId: 'outlet-001' },
  { id: 'sb-09', ingredientId: 'ing-09', ingredientName: 'Sparkling Water', category: 'Beverages', currentQty: 72, uom: 'bottles', reorderLevel: 24, status: 'normal', lastMovement: '2026-04-04T10:00:00', lastMovementType: 'goods_receipt', outletId: 'outlet-001' },
  { id: 'sb-10', ingredientId: 'ing-10', ingredientName: 'Butter', category: 'Dairy', currentQty: 0, uom: 'kg', reorderLevel: 4, status: 'out_of_stock', lastMovement: '2026-04-04T09:15:00', lastMovementType: 'waste', outletId: 'outlet-001' },
  { id: 'sb-11', ingredientId: 'ing-11', ingredientName: 'Flour (AP)', category: 'Pantry', currentQty: 22, uom: 'kg', reorderLevel: 10, status: 'normal', lastMovement: '2026-04-03T20:00:00', lastMovementType: 'goods_receipt', outletId: 'outlet-001' },
  { id: 'sb-12', ingredientId: 'ing-12', ingredientName: 'Tomato Sauce', category: 'Pantry', currentQty: 5, uom: 'L', reorderLevel: 6, status: 'low', lastMovement: '2026-04-04T12:30:00', lastMovementType: 'sale_reservation', outletId: 'outlet-001' },
];

export const mockLedgerEntries: LedgerEntry[] = [
  { id: 'le-01', datetime: '2026-04-04T14:30:00', transactionType: 'sale_reservation', ingredientId: 'ing-01', ingredientName: 'Salmon Fillet', quantityDelta: -0.35, resultingBalance: 12, uom: 'kg', sourceDocument: 'SO-4821', sourceType: 'Sale Order', actor: 'Aisha Patel', outletId: 'outlet-001' },
  { id: 'le-02', datetime: '2026-04-04T14:15:00', transactionType: 'sale_reservation', ingredientId: 'ing-02', ingredientName: 'Beef Patty', quantityDelta: -2, resultingBalance: 48, uom: 'pcs', sourceDocument: 'SO-4820', sourceType: 'Sale Order', actor: 'Aisha Patel', outletId: 'outlet-001' },
  { id: 'le-03', datetime: '2026-04-04T13:45:00', transactionType: 'goods_receipt', ingredientId: 'ing-03', ingredientName: 'Pizza Dough', quantityDelta: 20, resultingBalance: 24, uom: 'pcs', sourceDocument: 'GR-0284', sourceType: 'Goods Receipt', actor: 'Marcus Rivera', outletId: 'outlet-001' },
  { id: 'le-04', datetime: '2026-04-04T12:30:00', transactionType: 'sale_reservation', ingredientId: 'ing-12', ingredientName: 'Tomato Sauce', quantityDelta: -0.5, resultingBalance: 5, uom: 'L', sourceDocument: 'SO-4818', sourceType: 'Sale Order', actor: 'Aisha Patel', outletId: 'outlet-001' },
  { id: 'le-05', datetime: '2026-04-04T12:00:00', transactionType: 'sale_reservation', ingredientId: 'ing-04', ingredientName: 'Mozzarella Cheese', quantityDelta: -1.2, resultingBalance: 3, uom: 'kg', sourceDocument: 'SO-4817', sourceType: 'Sale Order', actor: 'Aisha Patel', outletId: 'outlet-001' },
  { id: 'le-06', datetime: '2026-04-04T11:30:00', transactionType: 'waste', ingredientId: 'ing-05', ingredientName: 'Mixed Lettuce', quantityDelta: -2, resultingBalance: 0, uom: 'kg', sourceDocument: 'WST-0045', sourceType: 'Waste Record', actor: 'Marcus Rivera', outletId: 'outlet-001', notes: 'Spoilage — expired produce' },
  { id: 'le-07', datetime: '2026-04-04T10:00:00', transactionType: 'goods_receipt', ingredientId: 'ing-09', ingredientName: 'Sparkling Water', quantityDelta: 48, resultingBalance: 72, uom: 'bottles', sourceDocument: 'GR-0283', sourceType: 'Goods Receipt', actor: 'Marcus Rivera', outletId: 'outlet-001' },
  { id: 'le-08', datetime: '2026-04-04T09:15:00', transactionType: 'waste', ingredientId: 'ing-10', ingredientName: 'Butter', quantityDelta: -2, resultingBalance: 0, uom: 'kg', sourceDocument: 'WST-0044', sourceType: 'Waste Record', actor: 'Marcus Rivera', outletId: 'outlet-001', notes: 'Temperature failure — cold chain break' },
  { id: 'le-09', datetime: '2026-04-04T08:00:00', transactionType: 'goods_receipt', ingredientId: 'ing-07', ingredientName: 'Espresso Beans', quantityDelta: 5, resultingBalance: 8, uom: 'kg', sourceDocument: 'GR-0282', sourceType: 'Goods Receipt', actor: 'Marcus Rivera', outletId: 'outlet-001' },
  { id: 'le-10', datetime: '2026-04-04T07:30:00', transactionType: 'stock_count', ingredientId: 'ing-08', ingredientName: 'Chicken Breast', quantityDelta: -1.5, resultingBalance: 2, uom: 'kg', sourceDocument: 'SC-0012', sourceType: 'Stock Count', actor: 'Marcus Rivera', outletId: 'outlet-001', notes: 'Variance correction from morning count' },
  { id: 'le-11', datetime: '2026-04-04T07:00:00', transactionType: 'adjustment', ingredientId: 'ing-11', ingredientName: 'Flour (AP)', quantityDelta: 2, resultingBalance: 22, uom: 'kg', sourceDocument: 'ADJ-0018', sourceType: 'Adjustment', actor: 'Marcus Rivera', outletId: 'outlet-001', notes: 'Found extra unopened bag' },
];

export const mockStockCounts: StockCountSession[] = [
  { id: 'sc-01', code: 'SC-0012', outletId: 'outlet-001', outletName: 'Downtown Flagship', createdBy: 'Marcus Rivera', status: 'posted', startedAt: '2026-04-04T06:30:00', postedAt: '2026-04-04T07:45:00', totalItems: 12, countedItems: 12, varianceItems: 3, varianceValue: -42.50 },
  { id: 'sc-02', code: 'SC-0011', outletId: 'outlet-001', outletName: 'Downtown Flagship', createdBy: 'Marcus Rivera', status: 'counting', startedAt: '2026-04-04T15:00:00', totalItems: 12, countedItems: 8, varianceItems: 2, varianceValue: -18.00 },
  { id: 'sc-03', code: 'SC-0010', outletId: 'outlet-001', outletName: 'Downtown Flagship', createdBy: 'Aisha Patel', status: 'cancelled', startedAt: '2026-04-03T06:00:00', cancelledAt: '2026-04-03T06:15:00', cancelReason: 'Duplicate session created in error', totalItems: 12, countedItems: 0, varianceItems: 0, varianceValue: 0 },
  { id: 'sc-04', code: 'SC-0009', outletId: 'outlet-001', outletName: 'Downtown Flagship', createdBy: 'Marcus Rivera', status: 'posted', startedAt: '2026-04-03T06:30:00', postedAt: '2026-04-03T07:30:00', totalItems: 12, countedItems: 12, varianceItems: 1, varianceValue: -8.20 },
];

export const mockCountLines: StockCountLine[] = [
  { id: 'cl-01', countSessionId: 'sc-02', ingredientId: 'ing-01', ingredientName: 'Salmon Fillet', uom: 'kg', systemQty: 12.35, actualQty: 12, variance: -0.35, category: 'Proteins' },
  { id: 'cl-02', countSessionId: 'sc-02', ingredientId: 'ing-02', ingredientName: 'Beef Patty', uom: 'pcs', systemQty: 50, actualQty: 48, variance: -2, category: 'Proteins' },
  { id: 'cl-03', countSessionId: 'sc-02', ingredientId: 'ing-03', ingredientName: 'Pizza Dough', uom: 'pcs', systemQty: 24, actualQty: 24, variance: 0, category: 'Bakery' },
  { id: 'cl-04', countSessionId: 'sc-02', ingredientId: 'ing-04', ingredientName: 'Mozzarella Cheese', uom: 'kg', systemQty: 4.2, actualQty: 3, variance: -1.2, category: 'Dairy' },
  { id: 'cl-05', countSessionId: 'sc-02', ingredientId: 'ing-05', ingredientName: 'Mixed Lettuce', uom: 'kg', systemQty: 2, actualQty: 0, variance: -2, category: 'Produce' },
  { id: 'cl-06', countSessionId: 'sc-02', ingredientId: 'ing-06', ingredientName: 'Olive Oil', uom: 'L', systemQty: 6, actualQty: 6, variance: 0, category: 'Pantry' },
  { id: 'cl-07', countSessionId: 'sc-02', ingredientId: 'ing-07', ingredientName: 'Espresso Beans', uom: 'kg', systemQty: 8, actualQty: 8, variance: 0, category: 'Beverages' },
  { id: 'cl-08', countSessionId: 'sc-02', ingredientId: 'ing-08', ingredientName: 'Chicken Breast', uom: 'kg', systemQty: 3.5, actualQty: null, variance: 0, category: 'Proteins' },
  { id: 'cl-09', countSessionId: 'sc-02', ingredientId: 'ing-09', ingredientName: 'Sparkling Water', uom: 'bottles', systemQty: 72, actualQty: null, variance: 0, category: 'Beverages' },
  { id: 'cl-10', countSessionId: 'sc-02', ingredientId: 'ing-10', ingredientName: 'Butter', uom: 'kg', systemQty: 0, actualQty: null, variance: 0, category: 'Dairy' },
  { id: 'cl-11', countSessionId: 'sc-02', ingredientId: 'ing-11', ingredientName: 'Flour (AP)', uom: 'kg', systemQty: 22, actualQty: null, variance: 0, category: 'Pantry' },
  { id: 'cl-12', countSessionId: 'sc-02', ingredientId: 'ing-12', ingredientName: 'Tomato Sauce', uom: 'L', systemQty: 5.5, actualQty: 5, variance: -0.5, category: 'Pantry' },
];

export const mockAdjustments: StockAdjustment[] = [
  {
    id: 'adj-01', code: 'ADJ-0018', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    createdBy: 'Marcus Rivera', createdAt: '2026-04-04T07:00:00', postedAt: '2026-04-04T07:05:00', status: 'posted',
    lines: [
      { id: 'al-01', ingredientId: 'ing-11', ingredientName: 'Flour (AP)', uom: 'kg', direction: 'increase', quantity: 2, reason: 'Found unrecorded stock', note: 'Extra unopened bag in dry storage' },
    ],
    notes: 'Morning reconciliation',
  },
  {
    id: 'adj-02', code: 'ADJ-0017', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    createdBy: 'Marcus Rivera', createdAt: '2026-04-03T16:00:00', status: 'draft',
    lines: [
      { id: 'al-02', ingredientId: 'ing-04', ingredientName: 'Mozzarella Cheese', uom: 'kg', direction: 'decrease', quantity: 0.5, reason: 'Damaged in storage' },
      { id: 'al-03', ingredientId: 'ing-09', ingredientName: 'Sparkling Water', uom: 'bottles', direction: 'decrease', quantity: 3, reason: 'Broken bottles' },
    ],
  },
];

export const mockWasteRecords: WasteRecord[] = [
  { id: 'wst-01', code: 'WST-0045', outletId: 'outlet-001', outletName: 'Downtown Flagship', ingredientId: 'ing-05', ingredientName: 'Mixed Lettuce', uom: 'kg', quantity: 2, reason: 'Spoilage — expired produce', recordedBy: 'Marcus Rivera', recordedAt: '2026-04-04T11:30:00', status: 'posted', postedAt: '2026-04-04T11:35:00', stockImpact: -2 },
  { id: 'wst-02', code: 'WST-0044', outletId: 'outlet-001', outletName: 'Downtown Flagship', ingredientId: 'ing-10', ingredientName: 'Butter', uom: 'kg', quantity: 2, reason: 'Temperature failure — cold chain break', recordedBy: 'Marcus Rivera', recordedAt: '2026-04-04T09:15:00', status: 'posted', postedAt: '2026-04-04T09:20:00', stockImpact: -2 },
  { id: 'wst-03', code: 'WST-0043', outletId: 'outlet-001', outletName: 'Downtown Flagship', ingredientId: 'ing-08', ingredientName: 'Chicken Breast', uom: 'kg', quantity: 0.8, reason: 'Preparation waste — trim loss', recordedBy: 'Aisha Patel', recordedAt: '2026-04-04T13:00:00', status: 'draft' },
];

export const INGREDIENT_CATEGORIES = ['All', 'Proteins', 'Dairy', 'Produce', 'Pantry', 'Bakery', 'Beverages'];

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  goods_receipt: 'Goods Receipt',
  sale_reservation: 'Sale Reservation',
  stock_count: 'Stock Count',
  adjustment: 'Adjustment',
  waste: 'Waste',
  transfer: 'Transfer',
  opening_balance: 'Opening Balance',
};
