import { useQuery } from '@tanstack/react-query';
import { salesApi, type SaleListItemView } from '@/api/sales-api';
import { useAuth } from '@/auth/use-auth';

export type OrderScope = 'pending' | 'today';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useOrdersFeed(
  outletId: string | null,
  scope: OrderScope,
  enabled: boolean,
  posSessionId: string | null = null,
) {
  const { session } = useAuth();
  const token = session?.accessToken;
  const pendingRequiresSession = scope === 'pending';
  const hasSessionForPending = pendingRequiresSession ? !!posSessionId : true;
  return useQuery({
    queryKey: ['pos-order-feed', scope, outletId, posSessionId],
    enabled: !!token && !!outletId && enabled && hasSessionForPending,
    queryFn: async () => {
      const params: Parameters<typeof salesApi.orders>[1] = {
        outletId: outletId!,
        limit: 50,
        sortBy: 'createdAt',
        sortDir: 'desc',
      };
      if (scope === 'pending') {
        params.paymentStatus = 'unpaid';
        if (posSessionId) params.posSessionId = posSessionId;
      } else {
        params.startDate = todayIso();
        params.endDate = todayIso();
        params.paymentStatus = 'paid';
      }
      const res = await salesApi.orders(token!, params);
      return res.items as SaleListItemView[];
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}
