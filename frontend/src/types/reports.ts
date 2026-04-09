// Report and analytics types

export interface RevenueKPI {
  label: string;
  value: string;
  change: number;
  changeLabel: string;
}

export interface RevenueTrend {
  date: string;
  revenue: number;
  orders: number;
}

export interface OutletRevenue {
  outletId: string;
  outletName: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
  rank: number;
}

export interface InventoryVarianceSummary {
  outletId: string;
  outletName: string;
  totalCounts: number;
  varianceItems: number;
  varianceValue: number;
  lastCountDate: string;
}

export interface LowStockItem {
  ingredientName: string;
  outletName: string;
  currentQty: number;
  unit: string;
  reorderPoint: number;
  status: 'low' | 'out';
}

export interface StockMovementSummary {
  type: string;
  count: number;
  totalQty: number;
  period: string;
}
