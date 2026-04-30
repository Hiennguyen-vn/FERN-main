import type {
  DailyRevenueRow,
  PosSessionView,
  ScopeOutlet,
  StockBalanceView,
} from '@/api/fern-api';

export interface RegionalOpsOutletRow {
  outletId: string;
  outletCode: string;
  outletName: string;
  outletStatus: string;
  netSales: number;
  grossSales: number;
  discounts: number;
  orderCount: number;
  avgOrderValue: number;
  sharePct: number;
  activeSessions: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface RegionalOpsSnapshot {
  currency: string;
  netSales: number;
  grossSales: number;
  discounts: number;
  orderCount: number;
  avgOrderValue: number;
  activeSessions: number;
  lowStockCount: number;
  outOfStockCount: number;
  outletsInScope: number;
  outletsWithSales: number;
  dataCoveragePct: number;
  outletRows: RegionalOpsOutletRow[];
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeStatus(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || 'unknown';
}

function isOpenSession(session: PosSessionView) {
  return String(session.status ?? '').trim().toLowerCase() === 'open';
}

function getOutletCurrency(outlets: ScopeOutlet[]) {
  for (const outlet of outlets) {
    const currency = String(outlet.currencyCode ?? '').trim();
    if (currency) return currency;
  }
  return 'VND';
}

export function buildRegionalOpsSnapshot(params: {
  outlets: ScopeOutlet[];
  dailyRows: DailyRevenueRow[];
  sessions: PosSessionView[];
  lowBalancesByOutlet: Map<string, StockBalanceView[]>;
}): RegionalOpsSnapshot {
  const { outlets, dailyRows, sessions, lowBalancesByOutlet } = params;
  const outletIds = new Set(outlets.map((outlet) => outlet.id));
  const revenueByOutlet = new Map<string, {
    netSales: number;
    grossSales: number;
    discounts: number;
    orderCount: number;
  }>();
  let currency = getOutletCurrency(outlets);

  for (const row of dailyRows) {
    const outletId = String(row.outletId ?? '');
    if (!outletId || (outletIds.size > 0 && !outletIds.has(outletId))) continue;
    const aggregate = revenueByOutlet.get(outletId) ?? {
      netSales: 0,
      grossSales: 0,
      discounts: 0,
      orderCount: 0,
    };
    aggregate.netSales += toNumber(row.netSales);
    aggregate.grossSales += toNumber(row.grossSales);
    aggregate.discounts += toNumber(row.discounts);
    aggregate.orderCount += toNumber(row.orderCount);
    revenueByOutlet.set(outletId, aggregate);
    if (row.currencyCode) currency = String(row.currencyCode);
  }

  const sessionsByOutlet = new Map<string, number>();
  for (const session of sessions) {
    const outletId = String(session.outletId ?? '');
    if (!outletId || (outletIds.size > 0 && !outletIds.has(outletId))) continue;
    if (!isOpenSession(session)) continue;
    sessionsByOutlet.set(outletId, (sessionsByOutlet.get(outletId) ?? 0) + 1);
  }

  let totalNetSales = 0;
  let totalGrossSales = 0;
  let totalDiscounts = 0;
  let totalOrders = 0;
  let totalActiveSessions = 0;
  let totalLowStock = 0;
  let totalOutOfStock = 0;

  const outletRows = outlets.map((outlet): RegionalOpsOutletRow => {
    const revenue = revenueByOutlet.get(outlet.id) ?? {
      netSales: 0,
      grossSales: 0,
      discounts: 0,
      orderCount: 0,
    };
    const lowBalances = lowBalancesByOutlet.get(outlet.id) ?? [];
    const outOfStockCount = lowBalances.filter((balance) => toNumber(balance.qtyOnHand) <= 0).length;
    const lowStockCount = Math.max(0, lowBalances.length - outOfStockCount);
    const activeSessions = sessionsByOutlet.get(outlet.id) ?? 0;

    totalNetSales += revenue.netSales;
    totalGrossSales += revenue.grossSales;
    totalDiscounts += revenue.discounts;
    totalOrders += revenue.orderCount;
    totalActiveSessions += activeSessions;
    totalLowStock += lowStockCount;
    totalOutOfStock += outOfStockCount;

    return {
      outletId: outlet.id,
      outletCode: outlet.code || outlet.id,
      outletName: outlet.name || outlet.id,
      outletStatus: normalizeStatus(outlet.status),
      netSales: revenue.netSales,
      grossSales: revenue.grossSales,
      discounts: revenue.discounts,
      orderCount: revenue.orderCount,
      avgOrderValue: revenue.orderCount > 0 ? revenue.netSales / revenue.orderCount : 0,
      sharePct: 0,
      activeSessions,
      lowStockCount,
      outOfStockCount,
    };
  });

  const rowsWithShare = outletRows
    .map((row) => ({
      ...row,
      sharePct: totalNetSales > 0 ? (row.netSales / totalNetSales) * 100 : 0,
    }))
    .sort((left, right) => {
      if (right.netSales !== left.netSales) return right.netSales - left.netSales;
      if (right.outOfStockCount !== left.outOfStockCount) return right.outOfStockCount - left.outOfStockCount;
      return left.outletCode.localeCompare(right.outletCode);
    });

  const outletsWithSales = rowsWithShare.filter((row) => row.orderCount > 0).length;

  return {
    currency,
    netSales: totalNetSales,
    grossSales: totalGrossSales,
    discounts: totalDiscounts,
    orderCount: totalOrders,
    avgOrderValue: totalOrders > 0 ? totalNetSales / totalOrders : 0,
    activeSessions: totalActiveSessions,
    lowStockCount: totalLowStock,
    outOfStockCount: totalOutOfStock,
    outletsInScope: outlets.length,
    outletsWithSales,
    dataCoveragePct: outlets.length > 0 ? (outletsWithSales / outlets.length) * 100 : 0,
    outletRows: rowsWithShare,
  };
}
