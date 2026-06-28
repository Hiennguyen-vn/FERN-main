import { useQuery } from '@tanstack/react-query';
import { salesApi, type SaleListItemView, type SalesOrdersQuery } from '@/api/sales-api';
import { useAuth } from '@/auth/use-auth';
import { todayLocalISO } from '@/lib/date-format';

export type OrderScope = 'pending' | 'today';

/** Pure builder for unit tests and shared query params. */
export function buildOrdersFeedQuery(
  scope: OrderScope,
  outletId: string,
  posSessionId: string | null,
): SalesOrdersQuery {
  const params: SalesOrdersQuery = {
    outletId,
    limit: 50,
    sortBy: 'createdAt',
    sortDir: 'desc',
  };
  if (scope === 'pending') {
    params.paymentStatus = 'unpaid';
  } else {
    params.paymentStatus = 'paid';
    // Calendar-day filter only when we are not scoped to the open shift.
    // With posSessionId, "Hôm nay" means paid orders in this session (avoids UTC/local drift).
    if (!posSessionId) {
      const today = todayLocalISO();
      params.startDate = today;
      params.endDate = today;
    }
  }
  if (posSessionId) {
    params.posSessionId = posSessionId;
  }
  return params;
}

export function useOrdersFeed(
  outletId: string | null,
  scope: OrderScope,
  enabled: boolean,
  posSessionId: string | null = null,
) {
  const { session } = useAuth();
  const token = session?.accessToken;
  const requiresOpenSession = true;
  const hasSession = requiresOpenSession ? !!posSessionId : true;
  return useQuery({
    queryKey: ['pos-order-feed', scope, outletId, posSessionId],
    enabled: !!token && !!outletId && enabled && hasSession,
    queryFn: async () => {
      const params = buildOrdersFeedQuery(scope, outletId!, posSessionId);
      const res = await salesApi.orders(token!, params);
      return res.items as SaleListItemView[];
    },
    staleTime: 5_000,
    refetchInterval: scope === 'today' && hasSession ? 15_000 : false,
    refetchOnWindowFocus: true,
  });
}
