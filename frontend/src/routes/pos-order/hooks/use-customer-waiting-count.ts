import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/use-auth';
import { salesApi } from '@/api/sales-api';
import { isWaitingCustomerOrder } from '@/components/pos/customer-order-queue';

export function useCustomerWaitingCount(outletId: string | null | undefined) {
  const { session } = useAuth();
  const token = session?.accessToken ?? '';
  return useQuery({
    queryKey: ['pos-order-customer-waiting', outletId],
    enabled: !!token && !!outletId,
    refetchInterval: 15000,
    queryFn: async () => {
      const page = await salesApi.orders(token, {
        outletId: String(outletId),
        publicOrderOnly: true,
        limit: 100,
        offset: 0,
        sortBy: 'createdAt',
        sortDir: 'desc',
      });
      return (page.items || []).filter(isWaitingCustomerOrder).length;
    },
  });
}
