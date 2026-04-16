import type {
  PaymentView,
  SaleListItemView,
  ScopeOutlet,
  ScopeRegion,
} from '@/api/fern-api';

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
  const netSales = completedOrders.reduce((sum, order) => sum + toNumber(order.totalAmount), 0);
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
      current.grossSales += toNumber(order.subtotal);
      current.netSales += toNumber(order.totalAmount);
      current.discounts += toNumber(order.discount);
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
      const outletNetSales = outletOrders.reduce((sum, order) => sum + toNumber(order.totalAmount), 0);

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

export function findPeriodComparison(options: FinancePeriodOption[], currentPeriodKey: string) {
  const currentIndex = options.findIndex((option) => option.key === currentPeriodKey);
  if (currentIndex < 0) {
    return null;
  }
  return options[currentIndex + 1] ?? null;
}
