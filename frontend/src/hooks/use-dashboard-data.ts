import { useCallback, useEffect, useState } from 'react';
import {
  inventoryApi,
  orgApi,
  productApi,
  salesApi,
  type ItemView,
  type SaleListItemView,
  type StockBalanceView,
} from '@/api/fern-api';
import { useShellRuntime } from '@/hooks/use-shell-runtime';

export interface DashboardKPIs {
  totalRevenue: number;
  totalOrders: number;
  completedOrders: number;
  avgOrderValue: number;
  activeSessions: number;
  lowStockCount: number;
  outOfStockCount: number;
  pendingOrders: number;
}

export interface RecentOrder {
  id: string;
  order_number: string;
  total: number;
  status: string;
  order_type: string | null;
  table_number: string | null;
  created_at: string;
}

export interface LowStockAlert {
  itemName: string;
  category: string | null;
  quantity: number;
  reorderLevel: number | null;
  outletName: string;
  critical: boolean;
}

export interface OutletRevenueSummary {
  outletId: string;
  outletName: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
}

type ApiRecord = Record<string, unknown>;

function toNumber(value: unknown) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function toRecord(value: unknown): ApiRecord | null {
  return value && typeof value === 'object' ? (value as ApiRecord) : null;
}

function normalizeNumericOutletId(value: string | undefined | null) {
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}

function isCompletedStatus(status: string) {
  return status === 'payment_done' || status === 'completed';
}

function isPendingStatus(status: string) {
  return status === 'order_created' || status === 'order_approved' || status === 'open';
}

async function fetchLowBalances(token: string, outletId: string) {
  const limit = 200;
  const maxPages = 10;
  const merged: StockBalanceView[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * limit;
    const response = await inventoryApi.balancesPage(token, {
      outletId,
      lowOnly: true,
      limit,
      offset,
      sortBy: 'qtyOnHand',
      sortDir: 'asc',
    });
    const rows = response.items || [];
    if (!rows.length) break;
    merged.push(...rows);
    if (!response.hasMore) break;
  }

  return merged;
}

export function useDashboardData() {
  const { token, scope } = useShellRuntime();
  const [kpis, setKpis] = useState<DashboardKPIs>({
    totalRevenue: 0, totalOrders: 0, completedOrders: 0, avgOrderValue: 0,
    activeSessions: 0, lowStockCount: 0, outOfStockCount: 0, pendingOrders: 0,
  });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [lowStock, setLowStock] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) {
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const outlets = await orgApi.outlets(token);
      const scopedOutletId = normalizeNumericOutletId(scope.outletId);
      const selectedOutletId = scopedOutletId || outlets[0]?.id || '';
      const selectedOutletName = outlets.find((outlet) => outlet.id === selectedOutletId)?.name || 'Unknown';

      const [ordersPage, sessionsPage, items] = await Promise.all([
        salesApi.orders(token, { outletId: selectedOutletId || undefined, limit: 100, offset: 0 }),
        salesApi.posSessions(token, { outletId: selectedOutletId || undefined, limit: 100, offset: 0 }),
        productApi.items(token),
      ]);

      const allOrders = ordersPage.items || [];
      const completed = allOrders.filter((order) => isCompletedStatus(String(order.status ?? '')));
      const totalRevenue = completed.reduce((sum, order) => sum + toNumber(order.totalAmount), 0);
      const pendingOrders = allOrders.filter((order) => isPendingStatus(String(order.status ?? ''))).length;
      const activeSessions = (sessionsPage.items || []).filter((session) => String(session.status) === 'open').length;

      const balances = selectedOutletId ? await fetchLowBalances(token, selectedOutletId) : [];
      const itemMap = new Map(
        (Array.isArray(items) ? items : [])
          .map((item) => toRecord(item))
          .filter((item): item is ApiRecord => item !== null)
          .map((item) => [String(item.id ?? ''), item] as const),
      );

      let lowStockCount = 0;
      let outOfStockCount = 0;
      const alerts: LowStockAlert[] = [];

      (balances || []).forEach((balance) => {
        const item = itemMap.get(String(balance.itemId));
        if (!item) return;
        const qty = toNumber(balance.qtyOnHand);
        const reorderLevel = item.minStockLevel == null ? null : toNumber(item.minStockLevel);
        if (reorderLevel == null) return;
        if (qty <= reorderLevel) {
          const critical = qty === 0 || qty <= reorderLevel * 0.3;
          if (qty === 0) outOfStockCount += 1;
          lowStockCount += 1;
          alerts.push({
            itemName: String(item.name ?? `Item ${balance.itemId}`),
            category: item.categoryCode ? String(item.categoryCode) : null,
            quantity: qty,
            reorderLevel,
            outletName: selectedOutletName,
            critical,
          });
        }
      });

      setKpis({
        totalRevenue,
        totalOrders: allOrders.length,
        completedOrders: completed.length,
        avgOrderValue: completed.length > 0 ? totalRevenue / completed.length : 0,
        activeSessions,
        lowStockCount,
        outOfStockCount,
        pendingOrders,
      });

      setRecentOrders(
        [...allOrders]
          .sort((a, b) => Date.parse(String(b.createdAt ?? 0)) - Date.parse(String(a.createdAt ?? 0)))
          .slice(0, 10)
          .map((order) => {
            const status = String(order.status ?? '');
            return {
              id: String(order.id),
              order_number: `SO-${String(order.id).slice(-6)}`,
              total: toNumber(order.totalAmount),
              status: isCompletedStatus(status) ? 'completed' : isPendingStatus(status) ? 'preparing' : status,
              order_type: order.orderType ? String(order.orderType) : null,
              table_number: order.orderingTableCode ? String(order.orderingTableCode) : null,
              created_at: String(order.createdAt ?? new Date().toISOString()),
            };
          }),
      );

      setLowStock(alerts.sort((a, b) => a.quantity - b.quantity).slice(0, 10));
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      setError('Dashboard data is currently unavailable from backend.');
    } finally {
      setLoading(false);
    }
  }, [scope.outletId, token]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { kpis, recentOrders, lowStock, loading, error, refresh: fetchData };
}

export function useRevenueReportData() {
  const { token, scope } = useShellRuntime();
  const [outletRevenue, setOutletRevenue] = useState<OutletRevenueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      if (!token) {
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const scopedOutletId = normalizeNumericOutletId(scope.outletId);
        const [outlets, ordersPage] = await Promise.all([
          orgApi.outlets(token),
          salesApi.orders(token, { outletId: scopedOutletId || undefined, limit: 100, offset: 0 }),
        ]);

        const visibleOutlets = scopedOutletId
          ? outlets.filter((outlet) => outlet.id === scopedOutletId)
          : outlets;

        const outletNameById = new Map(visibleOutlets.map((outlet) => [outlet.id, outlet.name]));
        const revenueByOutlet = new Map<string, { revenue: number; orders: number }>();

        (ordersPage.items || []).forEach((order) => {
          if (!isCompletedStatus(String(order.status ?? ''))) return;
          const outletId = String(order.outletId ?? '');
          if (!outletId) return;
          const aggregate = revenueByOutlet.get(outletId) ?? { revenue: 0, orders: 0 };
          aggregate.revenue += toNumber(order.totalAmount);
          aggregate.orders += 1;
          revenueByOutlet.set(outletId, aggregate);
        });

        const outletRevenueRows = Array.from(revenueByOutlet.entries())
          .map(([outletId, aggregate]) => ({
            outletId,
            outletName: outletNameById.get(outletId) || `Outlet ${outletId}`,
            revenue: aggregate.revenue,
            orders: aggregate.orders,
            avgOrderValue: aggregate.orders > 0 ? aggregate.revenue / aggregate.orders : 0,
          }))
          .sort((a, b) => b.revenue - a.revenue);

        setOutletRevenue(outletRevenueRows);
      } catch (error) {
        console.error('Report fetch error:', error);
        setError('Report data is currently unavailable from backend.');
      } finally {
        setLoading(false);
      }
    };
    void fetch();
  }, [scope.outletId, token]);

  return { outletRevenue, loading, error };
}

export function useInventoryHealthData() {
  const { token, scope } = useShellRuntime();
  const [lowStockItems, setLowStockItems] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      if (!token) {
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const scopedOutletId = normalizeNumericOutletId(scope.outletId);
        const [outlets, items] = await Promise.all([
          orgApi.outlets(token),
          productApi.items(token),
        ]);

        const visibleOutlets = scopedOutletId
          ? outlets.filter((outlet) => outlet.id === scopedOutletId)
          : outlets;

        const itemMap = new Map(
          (Array.isArray(items) ? items : [])
            .map((item) => toRecord(item))
            .filter((item): item is ApiRecord => item !== null)
            .map((item) => [String(item.id ?? ''), item] as const),
        );
        const balancesByOutlet = await Promise.all(
          visibleOutlets.map(async (outlet) => {
            const balances = await fetchLowBalances(token, outlet.id);
            return { outlet, balances };
          }),
        );

        const alerts: LowStockAlert[] = [];
        balancesByOutlet.forEach(({ outlet, balances }) => {
          (balances || []).forEach((balance) => {
            const item = itemMap.get(String(balance.itemId));
            if (!item) return;
            const quantity = toNumber(balance.qtyOnHand);
            const reorderLevel = item.minStockLevel == null ? null : toNumber(item.minStockLevel);
            if (reorderLevel == null || quantity > reorderLevel) return;
            alerts.push({
              itemName: String(item.name ?? `Item ${balance.itemId}`),
              category: item.categoryCode ? String(item.categoryCode) : null,
              quantity,
              reorderLevel,
              outletName: outlet.name,
              critical: quantity === 0,
            });
          });
        });

        setLowStockItems(alerts.sort((a, b) => a.quantity - b.quantity));
      } catch (error) {
        console.error('Inventory health fetch error:', error);
        setError('Inventory health data is currently unavailable from backend.');
      } finally {
        setLoading(false);
      }
    };
    void fetch();
  }, [scope.outletId, token]);

  return { lowStockItems, loading, error };
}
