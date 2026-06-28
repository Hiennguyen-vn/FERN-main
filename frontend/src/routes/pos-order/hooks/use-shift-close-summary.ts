import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { salesApi, type PosSessionView, type SaleListItemView } from '@/api/sales-api';
import { useAuth } from '@/auth/use-auth';
import {
  normalizePaymentMethod,
  paymentMethodLabel,
  resolveSalePaymentMethod,
} from '../utils/payment-methods';
import {
  decodeCashSessionSummary,
  decodePaymentSummary,
  resolveOpeningFloat,
  type CashSessionSummary,
} from '../utils/shift-close';

export interface PaymentBreakdownRow {
  method: string;
  label: string;
  total: number;
  count: number;
}

export interface ShiftCloseSummary {
  orderCount: number;
  totalRevenue: number;
  totalCollected: number;
  paymentBreakdown: PaymentBreakdownRow[];
  cash: CashSessionSummary | null;
}

function aggregateOrders(orders: SaleListItemView[]): Omit<ShiftCloseSummary, 'cash'> {
  const byMethod = new Map<string, { total: number; count: number }>();
  let totalCollected = 0;

  for (const order of orders) {
    const method = resolveSalePaymentMethod(order);
    const amount = Number(order.totalAmount ?? 0);
    const current = byMethod.get(method) ?? { total: 0, count: 0 };
    current.total += amount;
    current.count += 1;
    totalCollected += amount;
    byMethod.set(method, current);
  }

  const paymentBreakdown = [...byMethod.entries()]
    .map(([method, value]) => ({
      method,
      label: paymentMethodLabel(method),
      total: value.total,
      count: value.count,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    orderCount: orders.length,
    totalRevenue: totalCollected,
    totalCollected,
    paymentBreakdown,
  };
}

export function useShiftCloseSummary(
  outletId: string | null,
  posSessionId: string | null,
  session: PosSessionView | null,
  enabled: boolean,
) {
  const { session: authSession } = useAuth();
  const token = authSession?.accessToken;

  const query = useQuery({
    queryKey: ['pos-shift-close-summary', outletId, posSessionId],
    enabled: !!token && !!outletId && !!posSessionId && enabled,
    queryFn: async () => {
      const [ordersRes, cashRaw, paymentSummaryRaw] = await Promise.all([
        salesApi.orders(token!, {
          outletId: outletId!,
          posSessionId: posSessionId!,
          paymentStatus: 'paid',
          limit: 200,
          sortBy: 'createdAt',
          sortDir: 'desc',
        }),
        salesApi.cashSessionSummary(token!, posSessionId!).catch(() => null),
        salesApi.posSessionPaymentSummary(token!, posSessionId!).catch(() => null),
      ]);

      const ordersFallback = aggregateOrders(ordersRes.items);
      const fromPayments = paymentSummaryRaw && paymentSummaryRaw.items.length > 0
        ? decodePaymentSummary(paymentSummaryRaw)
        : null;
      const orders = fromPayments ?? ordersFallback;
      const cash = cashRaw ? decodeCashSessionSummary(cashRaw) : null;
      return { ...orders, cash };
    },
    staleTime: 5_000,
  });

  const summary = useMemo((): ShiftCloseSummary | null => {
    const fromQuery = query.data;
    if (fromQuery) {
      if (fromQuery.orderCount > 0 || fromQuery.cash) return fromQuery;
    }
    if (!session) return fromQuery ?? null;
    const orderCount = Number(session.orderCount ?? 0);
    const totalRevenue = Number(session.totalRevenue ?? 0);
    if (orderCount <= 0 && totalRevenue <= 0 && !fromQuery?.cash) {
      return fromQuery ?? null;
    }
    return {
      orderCount,
      totalRevenue,
      totalCollected: totalRevenue,
      paymentBreakdown: fromQuery?.paymentBreakdown ?? [],
      cash: fromQuery?.cash ?? null,
    };
  }, [query.data, session]);

  const openingCash = useMemo(
    () => resolveOpeningFloat(summary?.cash, readOpeningCashFallback(posSessionId)),
    [summary?.cash, posSessionId],
  );

  return {
    summary,
    openingCash,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/** Legacy client cache — used only when backend cash summary has no open float yet. */
export function readOpeningCashFallback(sessionId: string | null): number {
  if (!sessionId) return 0;
  const raw = sessionStorage.getItem(`pos-opening-cash-${sessionId}`);
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/** @deprecated Use useShiftCloseSummary().openingCash */
export function readOpeningCash(sessionId: string | null): number {
  return readOpeningCashFallback(sessionId);
}
