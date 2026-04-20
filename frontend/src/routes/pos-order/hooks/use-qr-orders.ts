import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salesApi, type SaleDetailView, type SaleListItemView } from '@/api/sales-api';
import { useAuth } from '@/auth/use-auth';

export function useQrOrders(outletId: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? '';
  return useQuery<SaleListItemView[]>({
    queryKey: ['qr-orders', outletId],
    enabled: !!token && !!outletId,
    refetchInterval: 10000,
    queryFn: async () => {
      const page = await salesApi.orders(token, {
        outletId: String(outletId),
        publicOrderOnly: true,
        limit: 100,
        offset: 0,
        sortBy: 'createdAt',
        sortDir: 'desc',
      });
      return page.items || [];
    },
  });
}

export function useQrOrderDetail(saleId: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? '';
  return useQuery<SaleDetailView>({
    queryKey: ['qr-order-detail', saleId],
    enabled: !!token && !!saleId,
    queryFn: () => salesApi.orderDetail(token, String(saleId)),
  });
}

export function useApproveQrOrder() {
  const { session } = useAuth();
  const token = session?.accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saleId: string) => salesApi.approveOrder(token, saleId),
    onSuccess: (_data, saleId) => {
      qc.invalidateQueries({ queryKey: ['qr-orders'] });
      qc.invalidateQueries({ queryKey: ['qr-order-detail', saleId] });
      qc.invalidateQueries({ queryKey: ['pos-order-customer-waiting'] });
      qc.invalidateQueries({ queryKey: ['pos-order-feed'] });
    },
  });
}

export function useCancelQrOrder() {
  const { session } = useAuth();
  const token = session?.accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { saleId: string; reason?: string }) =>
      salesApi.cancelOrder(token, args.saleId, { reason: args.reason ?? null }),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ['qr-orders'] });
      qc.invalidateQueries({ queryKey: ['qr-order-detail', args.saleId] });
      qc.invalidateQueries({ queryKey: ['pos-order-customer-waiting'] });
      qc.invalidateQueries({ queryKey: ['pos-order-feed'] });
    },
  });
}
