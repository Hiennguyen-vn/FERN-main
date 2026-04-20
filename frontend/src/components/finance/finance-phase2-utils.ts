import type {
  PaymentView,
  SaleListItemView,
  ScopeOutlet,
  ScopeRegion,
} from '@/api/fern-api';
import type { DailyRevenueRow, MonthlyRevenueRow } from '@/api/sales-api';
import type { MonthlyExpenseRow } from '@/api/finance-api';
import type { MonthlyPayrollRow } from '@/api/payroll-api';

export type RevenueChannelFilter = 'all' | 'dine_in' | 'delivery' | 'takeaway';
type RevenueChannelValue = 'dine_in' | 'delivery' | 'takeaway' | 'other';

export interface FinancePeriodOption {
  key: string;
  label: string;
}

export interface RevenueMixRow {
  key: string;
  label: string;
  amount: number;
  count: number;
  pct: number;
}

export interface RevenueTrendPoint {
  dateKey: string;
  label: string;
  grossSales: number;
  netSales: number;
  discounts: number;
  orderCount: number;
}

export interface RevenueOutletRow {
  outletId: string;
  outletCode: string;
  outletName: string;
  grossSales: number;
  discounts: number;
  voids: number;
  netSales: number;
  orderCount: number;
  avgOrderValue: number;
  sharePct: number;
  paymentLead: string;
  channelLead: string;
}

export interface RevenueSnapshot {
  currency: string;
  grossSales: number;
  discounts: number;
  refunds: number;
  voids: number;
  netSales: number;
  completedOrderCount: number;
  avgOrderValue: number;
  paymentCoveragePct: number;
  trend: RevenueTrendPoint[];
  outletRows: RevenueOutletRow[];
  paymentMix: RevenueMixRow[];
  channelMix: RevenueMixRow[];
}

export type FinanceVarianceStatus = 'clear' | 'watch' | 'risk' | 'no-sales';

function labelizeToken(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function getFinanceVisibleOutlets(
  outlets: ScopeOutlet[],
  scopeRegionId?: string,
  scopeOutletId?: string,
) {
  if (scopeOutletId) {
    return outlets.filter((outlet) => outlet.id === scopeOutletId);
  }
  if (scopeRegionId) {
    return outlets.filter((outlet) => outlet.regionId === scopeRegionId);
  }
  return outlets;
}

export function describeFinanceScope(params: {
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}) {
  const {
    scopeRegionId,
    scopeOutletId,
    regions,
    outlets,
  } = params;

  if (scopeOutletId) {
    const outlet = outlets.find((candidate) => candidate.id === scopeOutletId);
    const region = outlet
      ? regions.find((candidate) => candidate.id === outlet.regionId)
      : undefined;
    if (outlet && region) {
      return `${outlet.code} · ${region.name}`;
    }
    return outlet?.name || 'Selected outlet';
  }

  if (scopeRegionId) {
    const region = regions.find((candidate) => candidate.id === scopeRegionId);
    return region?.name || 'Selected region';
  }

  return 'All regions';
}

export function isCompletedSale(status?: string | null) {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized === 'completed' || normalized === 'payment_done';
}

export function isCancelledSale(status?: string | null) {
  return String(status ?? '').trim().toLowerCase() === 'cancelled';
}

export function getDateKey(value?: string | null) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 10) : '';
}

export function getPeriodKey(value?: string | null) {
  const normalized = getDateKey(value);
  return normalized ? normalized.slice(0, 7) : '';
}

export function formatPeriodLabel(periodKey: string) {
  if (!periodKey) {
    return 'Current period';
  }
  const date = new Date(`${periodKey}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return periodKey;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatShortDayLabel(dateKey: string) {
  if (!dateKey) {
    return '—';
  }
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function normalizeRevenueChannelValue(orderType?: string | null): RevenueChannelValue {
  const normalized = String(orderType ?? '').trim().toLowerCase();
  if (normalized === 'dine_in') return 'dine_in';
  if (normalized === 'delivery') return 'delivery';
  if (normalized === 'takeout' || normalized === 'takeaway') return 'takeaway';
  return 'other';
}

export function formatRevenueChannelLabel(channel: RevenueChannelFilter | RevenueChannelValue) {
  if (channel === 'all') return 'All channels';
  if (channel === 'dine_in') return 'Dine-in';
  if (channel === 'delivery') return 'Delivery';
  if (channel === 'takeaway') return 'Takeout';
  return 'Other';
}

export function getFinanceVarianceStatus(
  laborPct: number | null,
  otherOpExPct: number | null,
  netSales: number,
): FinanceVarianceStatus {
  if (netSales <= 0) {
    return 'no-sales';
  }
  if (laborPct != null && laborPct > 40) {
    return 'risk';
  }
  if ((laborPct != null && laborPct > 35) || (otherOpExPct != null && otherOpExPct > 25)) {
    return 'watch';
  }
  return 'clear';
}

export function buildFinancePeriodOptions(orders: SaleListItemView[]) {
  const keys = Array.from(
    new Set(
      orders
        .map((order) => getPeriodKey(order.createdAt))
        .filter(Boolean),
    ),
  ).sort((left, right) => right.localeCompare(left));

  return keys.map((key) => ({
    key,
    label: formatPeriodLabel(key),
  })) satisfies FinancePeriodOption[];
}

function collectScopedOrders(orders: SaleListItemView[], visibleOutlets: ScopeOutlet[]) {
  const visibleOutletIds = new Set(visibleOutlets.map((outlet) => outlet.id));
  if (visibleOutletIds.size === 0) {
    return orders;
  }
  return orders.filter((order) => visibleOutletIds.has(String(order.outletId ?? '')));
}

function buildMixRows(records: Map<string, { amount: number; count: number }>) {
  const total = Array.from(records.values()).reduce((sum, item) => sum + item.amount, 0);
  return Array.from(records.entries())
    .map(([key, item]) => ({
      key,
      label: key === 'other' ? 'Other' : labelizeToken(key),
      amount: item.amount,
      count: item.count,
      pct: total > 0 ? (item.amount / total) * 100 : 0,
    }))
    .sort((left, right) => right.amount - left.amount);
}

function getPaymentKey(payment?: PaymentView | null) {
  const raw = String(payment?.paymentMethod ?? '').trim().toLowerCase();
  return raw || 'unspecified';
}

export function buildRevenueSnapshot(params: {
  orders: SaleListItemView[];
  visibleOutlets: ScopeOutlet[];
  periodKey: string;
  channelFilter: RevenueChannelFilter;
}) {
  const {
    orders,
    visibleOutlets,
    periodKey,
    channelFilter,
  } = params;

  const scopedOrders = collectScopedOrders(orders, visibleOutlets).filter((order) => {
    const orderPeriodKey = getPeriodKey(order.createdAt);
    if (periodKey && orderPeriodKey !== periodKey) {
      return false;
    }

    const channel = normalizeRevenueChannelValue(order.orderType);
    if (channelFilter !== 'all' && channel !== channelFilter) {
      return false;
    }

    return true;
  });

  const completedOrders = scopedOrders.filter((order) => isCompletedSale(order.status));
  const cancelledOrders = scopedOrders.filter((order) => isCancelledSale(order.status));
  const grossSales = completedOrders.reduce((sum, order) => sum + toNumber(order.subtotal), 0);
  const discounts = completedOrders.reduce((sum, order) => sum + toNumber(order.discount), 0);
  const netSales = grossSales - discounts;
  const voids = cancelledOrders.reduce(
    (sum, order) => sum + (toNumber(order.subtotal) || toNumber(order.totalAmount)),
    0,
  );

  const trendMap = new Map<string, RevenueTrendPoint>();
  const paymentMix = new Map<string, { amount: number; count: number }>();
  const channelMix = new Map<string, { amount: number; count: number }>();

  completedOrders.forEach((order) => {
    const dateKey = getDateKey(order.createdAt);
    if (dateKey) {
      const current = trendMap.get(dateKey) ?? {
        dateKey,
        label: formatShortDayLabel(dateKey),
        grossSales: 0,
        netSales: 0,
        discounts: 0,
        orderCount: 0,
      };
      const orderGross = toNumber(order.subtotal);
      const orderDiscount = toNumber(order.discount);
      current.grossSales += orderGross;
      current.netSales += orderGross - orderDiscount;
      current.discounts += orderDiscount;
      current.orderCount += 1;
      trendMap.set(dateKey, current);
    }

    const paymentKey = getPaymentKey(order.payment);
    const paymentRow = paymentMix.get(paymentKey) ?? { amount: 0, count: 0 };
    paymentRow.amount += toNumber(order.totalAmount);
    paymentRow.count += 1;
    paymentMix.set(paymentKey, paymentRow);

    const channelKey = normalizeRevenueChannelValue(order.orderType);
    const channelRow = channelMix.get(channelKey) ?? { amount: 0, count: 0 };
    channelRow.amount += toNumber(order.totalAmount);
    channelRow.count += 1;
    channelMix.set(channelKey, channelRow);
  });

  const paymentCodedOrders = completedOrders.filter((order) => {
    return String(order.payment?.paymentMethod ?? '').trim().length > 0;
  }).length;

  const totalNetSales = netSales;

  const outletRows = visibleOutlets
    .map((outlet): RevenueOutletRow => {
      const outletOrders = completedOrders.filter((order) => String(order.outletId ?? '') === outlet.id);
      const outletVoids = cancelledOrders
        .filter((order) => String(order.outletId ?? '') === outlet.id)
        .reduce((sum, order) => sum + (toNumber(order.subtotal) || toNumber(order.totalAmount)), 0);

      const outletPaymentMix = new Map<string, { amount: number; count: number }>();
      const outletChannelMix = new Map<string, { amount: number; count: number }>();

      outletOrders.forEach((order) => {
        const paymentKey = getPaymentKey(order.payment);
        const paymentRow = outletPaymentMix.get(paymentKey) ?? { amount: 0, count: 0 };
        paymentRow.amount += toNumber(order.totalAmount);
        paymentRow.count += 1;
        outletPaymentMix.set(paymentKey, paymentRow);

        const channelKey = normalizeRevenueChannelValue(order.orderType);
        const channelRow = outletChannelMix.get(channelKey) ?? { amount: 0, count: 0 };
        channelRow.amount += toNumber(order.totalAmount);
        channelRow.count += 1;
        outletChannelMix.set(channelKey, channelRow);
      });

      const outletGrossSales = outletOrders.reduce((sum, order) => sum + toNumber(order.subtotal), 0);
      const outletDiscounts = outletOrders.reduce((sum, order) => sum + toNumber(order.discount), 0);
      const outletNetSales = outletGrossSales - outletDiscounts;

      return {
        outletId: outlet.id,
        outletCode: outlet.code || outlet.id,
        outletName: outlet.name || outlet.id,
        grossSales: outletGrossSales,
        discounts: outletDiscounts,
        voids: outletVoids,
        netSales: outletNetSales,
        orderCount: outletOrders.length,
        avgOrderValue: outletOrders.length > 0 ? outletNetSales / outletOrders.length : 0,
        sharePct: totalNetSales > 0 ? (outletNetSales / totalNetSales) * 100 : 0,
        paymentLead: buildMixRows(outletPaymentMix)[0]?.label || '—',
        channelLead: buildMixRows(outletChannelMix)[0]?.label || '—',
      };
    })
    .filter((row) => row.orderCount > 0 || row.voids > 0 || visibleOutlets.length === 1)
    .sort((left, right) => right.netSales - left.netSales);

  const currency = completedOrders.find((order) => order.currencyCode)?.currencyCode
    || cancelledOrders.find((order) => order.currencyCode)?.currencyCode
    || 'USD';

  return {
    currency: String(currency),
    grossSales,
    discounts,
    refunds: 0,
    voids,
    netSales,
    completedOrderCount: completedOrders.length,
    avgOrderValue: completedOrders.length > 0 ? netSales / completedOrders.length : 0,
    paymentCoveragePct: completedOrders.length > 0 ? (paymentCodedOrders / completedOrders.length) * 100 : 0,
    trend: Array.from(trendMap.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
    outletRows,
    paymentMix: buildMixRows(paymentMix),
    channelMix: buildMixRows(channelMix).map((row) => ({
      ...row,
      label: formatRevenueChannelLabel(row.key as RevenueChannelValue),
    })),
  } satisfies RevenueSnapshot;
}

export function buildFinancePeriodOptionsFromMonthly(rows: MonthlyRevenueRow[]) {
  const keys = Array.from(
    new Set(
      rows
        .map((row) => String(row.month ?? '').trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.localeCompare(left));
  return keys.map((key) => ({
    key,
    label: formatPeriodLabel(key),
  })) satisfies FinancePeriodOption[];
}

function matchesChannelFilter(rawKey: string, filter: RevenueChannelFilter) {
  if (filter === 'all') return true;
  const normalized = normalizeRevenueChannelValue(rawKey);
  return normalized === filter;
}

export function buildRevenueSnapshotFromDaily(params: {
  dailyRows: DailyRevenueRow[];
  visibleOutlets: ScopeOutlet[];
  channelFilter: RevenueChannelFilter;
}): RevenueSnapshot {
  const { dailyRows, visibleOutlets, channelFilter } = params;
  const visibleIds = new Set(visibleOutlets.map((outlet) => outlet.id));
  const scoped = dailyRows.filter(
    (row) => visibleIds.size === 0 || visibleIds.has(String(row.outletId)),
  );

  const trendMap = new Map<string, RevenueTrendPoint>();
  const paymentMix = new Map<string, { amount: number; count: number }>();
  const channelMix = new Map<string, { amount: number; count: number }>();

  let grossSales = 0;
  let discounts = 0;
  let netSales = 0;
  let voids = 0;
  let completedOrderCount = 0;
  let paymentCodedOrders = 0;
  let currency = 'USD';

  const outletAgg = new Map<string, {
    grossSales: number;
    discounts: number;
    voids: number;
    netSales: number;
    orderCount: number;
    payments: Map<string, { amount: number; count: number }>;
    channels: Map<string, { amount: number; count: number }>;
  }>();

  for (const row of scoped) {
    const outletId = String(row.outletId);
    const filteredChannels = (row.channelMix ?? []).filter((entry) => matchesChannelFilter(entry.key, channelFilter));

    let dayGross: number;
    let dayDiscount: number;
    let dayNet: number;
    let dayOrders: number;
    let dayTotalAmount: number;

    if (channelFilter === 'all') {
      dayGross = toNumber(row.grossSales);
      dayDiscount = toNumber(row.discounts);
      dayNet = toNumber(row.netSales);
      dayOrders = Number(row.orderCount ?? 0);
      dayTotalAmount = toNumber(row.totalAmount);
    } else {
      dayTotalAmount = filteredChannels.reduce((sum, entry) => sum + toNumber(entry.amount), 0);
      dayOrders = filteredChannels.reduce((sum, entry) => sum + Number(entry.orderCount ?? 0), 0);
      const rowOrders = Number(row.orderCount ?? 0);
      const ratio = rowOrders > 0 ? dayOrders / rowOrders : 0;
      dayGross = toNumber(row.grossSales) * ratio;
      dayDiscount = toNumber(row.discounts) * ratio;
      dayNet = toNumber(row.netSales) * ratio;
    }

    if (dayOrders === 0 && Number(row.cancelledCount ?? 0) === 0) {
      continue;
    }

    grossSales += dayGross;
    discounts += dayDiscount;
    netSales += dayNet;
    voids += toNumber(row.voids);
    completedOrderCount += dayOrders;
    if (row.currencyCode) currency = String(row.currencyCode);

    const dateKey = String(row.businessDate ?? '').slice(0, 10);
    if (dateKey) {
      const trend = trendMap.get(dateKey) ?? {
        dateKey,
        label: formatShortDayLabel(dateKey),
        grossSales: 0,
        netSales: 0,
        discounts: 0,
        orderCount: 0,
      };
      trend.grossSales += dayGross;
      trend.netSales += dayNet;
      trend.discounts += dayDiscount;
      trend.orderCount += dayOrders;
      trendMap.set(dateKey, trend);
    }

    const outletEntry = outletAgg.get(outletId) ?? {
      grossSales: 0,
      discounts: 0,
      voids: 0,
      netSales: 0,
      orderCount: 0,
      payments: new Map(),
      channels: new Map(),
    };
    outletEntry.grossSales += dayGross;
    outletEntry.discounts += dayDiscount;
    outletEntry.netSales += dayNet;
    outletEntry.voids += toNumber(row.voids);
    outletEntry.orderCount += dayOrders;

    for (const entry of row.paymentMix ?? []) {
      const amount = toNumber(entry.amount);
      const count = Number(entry.orderCount ?? 0);
      if (channelFilter !== 'all') {
        const rowOrders = Number(row.orderCount ?? 0);
        const ratio = rowOrders > 0 ? dayOrders / rowOrders : 0;
        const adjAmount = amount * ratio;
        const adjCount = count * ratio;
        const current = paymentMix.get(entry.key) ?? { amount: 0, count: 0 };
        current.amount += adjAmount;
        current.count += adjCount;
        paymentMix.set(entry.key, current);
        const outletCurrent = outletEntry.payments.get(entry.key) ?? { amount: 0, count: 0 };
        outletCurrent.amount += adjAmount;
        outletCurrent.count += adjCount;
        outletEntry.payments.set(entry.key, outletCurrent);
        paymentCodedOrders += adjCount;
      } else {
        const current = paymentMix.get(entry.key) ?? { amount: 0, count: 0 };
        current.amount += amount;
        current.count += count;
        paymentMix.set(entry.key, current);
        const outletCurrent = outletEntry.payments.get(entry.key) ?? { amount: 0, count: 0 };
        outletCurrent.amount += amount;
        outletCurrent.count += count;
        outletEntry.payments.set(entry.key, outletCurrent);
        paymentCodedOrders += count;
      }
    }

    for (const entry of filteredChannels) {
      const amount = toNumber(entry.amount);
      const count = Number(entry.orderCount ?? 0);
      const channelKey = normalizeRevenueChannelValue(entry.key);
      const current = channelMix.get(channelKey) ?? { amount: 0, count: 0 };
      current.amount += amount;
      current.count += count;
      channelMix.set(channelKey, current);
      const outletCurrent = outletEntry.channels.get(channelKey) ?? { amount: 0, count: 0 };
      outletCurrent.amount += amount;
      outletCurrent.count += count;
      outletEntry.channels.set(channelKey, outletCurrent);
    }

    outletAgg.set(outletId, outletEntry);
  }

  const totalNetSales = netSales;
  const outletRows = visibleOutlets
    .map((outlet): RevenueOutletRow => {
      const entry = outletAgg.get(outlet.id);
      if (!entry) {
        return {
          outletId: outlet.id,
          outletCode: outlet.code || outlet.id,
          outletName: outlet.name || outlet.id,
          grossSales: 0,
          discounts: 0,
          voids: 0,
          netSales: 0,
          orderCount: 0,
          avgOrderValue: 0,
          sharePct: 0,
          paymentLead: '—',
          channelLead: '—',
        };
      }
      const paymentRows = buildMixRows(entry.payments);
      const channelRows = buildMixRows(entry.channels).map((row) => ({
        ...row,
        label: formatRevenueChannelLabel(row.key as RevenueChannelValue),
      }));
      return {
        outletId: outlet.id,
        outletCode: outlet.code || outlet.id,
        outletName: outlet.name || outlet.id,
        grossSales: entry.grossSales,
        discounts: entry.discounts,
        voids: entry.voids,
        netSales: entry.netSales,
        orderCount: entry.orderCount,
        avgOrderValue: entry.orderCount > 0 ? entry.netSales / entry.orderCount : 0,
        sharePct: totalNetSales > 0 ? (entry.netSales / totalNetSales) * 100 : 0,
        paymentLead: paymentRows[0]?.label || '—',
        channelLead: channelRows[0]?.label || '—',
      };
    })
    .filter((row) => row.orderCount > 0 || row.voids > 0 || visibleOutlets.length === 1)
    .sort((left, right) => right.netSales - left.netSales);

  return {
    currency,
    grossSales,
    discounts,
    refunds: 0,
    voids,
    netSales,
    completedOrderCount,
    avgOrderValue: completedOrderCount > 0 ? netSales / completedOrderCount : 0,
    paymentCoveragePct: completedOrderCount > 0 ? (paymentCodedOrders / completedOrderCount) * 100 : 0,
    trend: Array.from(trendMap.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
    outletRows,
    paymentMix: buildMixRows(new Map(Array.from(paymentMix.entries()))),
    channelMix: buildMixRows(new Map(Array.from(channelMix.entries()))).map((row) => ({
      ...row,
      label: formatRevenueChannelLabel(row.key as RevenueChannelValue),
    })),
  } satisfies RevenueSnapshot;
}

export interface MonthlyPlData {
  currency: string;
  periodKey: string;
  grossSales: number;
  discounts: number;
  netSales: number;
  voids: number;
  completedOrders: number;
  payrollCost: number;
  inventoryExpenses: number;
  invoiceExpenses: number;
  manualExpenses: number;
  totalOpEx: number;
  totalCosts: number;
  operatingIncome: number;
  laborPct: number | null;
  opExPct: number | null;
  incomePct: number | null;
  outletRows: Array<{
    outletId: string;
    outletCode: string;
    outletName: string;
    netSales: number;
    grossSales: number;
    payroll: number;
    opEx: number;
    totalCosts: number;
    operatingIncome: number;
    laborPct: number | null;
    opExPct: number | null;
    incomePct: number | null;
  }>;
}

export function buildMonthlyPl(options: {
  revenueRows: MonthlyRevenueRow[];
  expenseRows: MonthlyExpenseRow[];
  payrollRows: MonthlyPayrollRow[];
  periodKey: string;
  visibleOutlets: ScopeOutlet[];
}): MonthlyPlData {
  const { revenueRows, expenseRows, payrollRows, periodKey, visibleOutlets } = options;
  const visibleIds = new Set(visibleOutlets.map((o) => o.id));

  const revFiltered = revenueRows.filter(
    (r) => r.month === periodKey
      && (visibleIds.size === 0 || visibleIds.has(String(r.outletId))),
  );
  const expFiltered = expenseRows.filter(
    (e) => e.month === periodKey
      && (visibleIds.size === 0 || visibleIds.has(String(e.outletId))),
  );
  const payFiltered = payrollRows.filter((p) => {
    if (p.month !== periodKey) return false;
    const st = String(p.status || '').toLowerCase();
    if (st !== 'approved' && st !== 'paid') return false;
    return visibleIds.size === 0 || visibleIds.has(String(p.outletId ?? ''));
  });

  let grossSales = 0;
  let discounts = 0;
  let netSales = 0;
  let voids = 0;
  let completedOrders = 0;
  let currency = 'USD';
  for (const r of revFiltered) {
    grossSales += toNumber(r.grossSales);
    discounts += toNumber(r.discounts);
    netSales += toNumber(r.netSales);
    voids += toNumber(r.voids);
    completedOrders += Number(r.orderCount ?? 0);
    if (r.currencyCode) currency = String(r.currencyCode);
  }

  let payrollCost = 0;
  for (const p of payFiltered) payrollCost += toNumber(p.netSalary);

  let inventoryExpenses = 0;
  let invoiceExpenses = 0;
  let manualExpenses = 0;
  for (const e of expFiltered) {
    const src = String(e.sourceType || '').toLowerCase();
    if (src === 'payroll') continue;
    const amt = toNumber(e.amount);
    if (src === 'inventory_purchase') inventoryExpenses += amt;
    else if (src.includes('invoice')) invoiceExpenses += amt;
    else manualExpenses += amt;
  }
  const totalOpEx = inventoryExpenses + invoiceExpenses + manualExpenses;
  const totalCosts = payrollCost + totalOpEx;
  const operatingIncome = netSales - totalCosts;

  const outletRows = visibleOutlets.map((outlet) => {
    const oid = outlet.id;
    const revRow = revFiltered.find((r) => String(r.outletId) === oid);
    const outletNet = toNumber(revRow?.netSales);
    const outletGross = toNumber(revRow?.grossSales);
    const outletPay = payFiltered
      .filter((p) => String(p.outletId ?? '') === oid)
      .reduce((s, p) => s + toNumber(p.netSalary), 0);
    const outletOpEx = expFiltered
      .filter((e) => {
        if (String(e.outletId) !== oid) return false;
        return String(e.sourceType || '').toLowerCase() !== 'payroll';
      })
      .reduce((s, e) => s + toNumber(e.amount), 0);
    const outletCosts = outletPay + outletOpEx;
    const outletIncome = outletNet - outletCosts;
    return {
      outletId: oid,
      outletCode: outlet.code || oid,
      outletName: outlet.name || oid,
      netSales: outletNet,
      grossSales: outletGross,
      payroll: outletPay,
      opEx: outletOpEx,
      totalCosts: outletCosts,
      operatingIncome: outletIncome,
      laborPct: outletNet > 0 ? (outletPay / outletNet) * 100 : null,
      opExPct: outletNet > 0 ? (outletOpEx / outletNet) * 100 : null,
      incomePct: outletNet > 0 ? (outletIncome / outletNet) * 100 : null,
    };
  }).filter((row) => row.netSales > 0 || row.payroll > 0 || row.opEx > 0);

  return {
    currency,
    periodKey,
    grossSales,
    discounts,
    netSales,
    voids,
    completedOrders,
    payrollCost,
    inventoryExpenses,
    invoiceExpenses,
    manualExpenses,
    totalOpEx,
    totalCosts,
    operatingIncome,
    laborPct: netSales > 0 ? (payrollCost / netSales) * 100 : null,
    opExPct: netSales > 0 ? (totalOpEx / netSales) * 100 : null,
    incomePct: netSales > 0 ? (operatingIncome / netSales) * 100 : null,
    outletRows,
  };
}

export function availablePeriodsFromMonthly(
  revenueRows: MonthlyRevenueRow[],
  expenseRows: MonthlyExpenseRow[],
  payrollRows: MonthlyPayrollRow[],
): string[] {
  const keys = new Set<string>();
  for (const r of revenueRows) if (r.month) keys.add(r.month);
  for (const e of expenseRows) if (e.month) keys.add(e.month);
  for (const p of payrollRows) if (p.month) keys.add(p.month);
  return [...keys].sort().reverse();
}

export function findPeriodComparison(options: FinancePeriodOption[], currentPeriodKey: string) {
  const currentIndex = options.findIndex((option) => option.key === currentPeriodKey);
  if (currentIndex < 0) {
    return null;
  }
  return options[currentIndex + 1] ?? null;
}
