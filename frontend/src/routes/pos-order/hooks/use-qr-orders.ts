import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salesApi, type PublicOrderBatchView, type SaleDetailView, type SaleListItemView } from '@/api/sales-api';
import { useAuth } from '@/auth/use-auth';
import { getCustomerOrderQueueFilter } from '@/components/pos/customer-order-queue';

function batchToSaleListItem(batch: PublicOrderBatchView): SaleListItemView {
  return {
    id: batch.id,
    outletId: batch.outletId,
    posSessionId: null,
    publicOrderToken: batch.orderToken,
    status:
      batch.status === 'approved'
        ? 'order_approved'
        : batch.status === 'pending'
          ? 'order_created'
          : batch.status === 'rejected' || batch.status === 'cancelled'
            ? 'cancelled'
            : batch.status,
    paymentStatus: batch.paymentStatus ?? (batch.status === 'approved' ? 'unpaid' : 'pending'),
    orderType: 'online',
    orderingTableCode: batch.orderingTableCode,
    orderingTableName: batch.orderingTableName,
    currencyCode: batch.currencyCode,
    subtotal: batch.totalAmount,
    discount: 0,
    taxAmount: 0,
    totalAmount: batch.totalAmount,
    note: batch.note,
    createdAt: batch.createdAt,
    items: (batch.items || []).map((item) => ({
      productId: item.productId,
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      note: item.note,
      status: item.status,
    })),
    payment: null,
    saleId: batch.saleId,
  };
}

export function useQrOrders(outletId: string | null, enabled = true) {
  const { session } = useAuth();
  const token = session?.accessToken ?? '';
  return useQuery<SaleListItemView[]>({
    queryKey: ['qr-orders', outletId],
    enabled: !!token && !!outletId && enabled,
    refetchInterval: 10000,
    staleTime: 5000,
    queryFn: async () => {
      const batches = await salesApi.publicOrderBatches(token, { outletId: String(outletId) });
      return batches.map(batchToSaleListItem);
    },
  });
}

export function useQrOrderDetail(order: SaleListItemView | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? '';
  const saleId = order?.saleId ? String(order.saleId) : null;
  const needsSaleDetail = Boolean(saleId && order && getCustomerOrderQueueFilter(order) !== 'waiting');
  return useQuery<SaleDetailView>({
    queryKey: ['qr-order-detail', saleId],
    enabled: !!token && needsSaleDetail,
    queryFn: () => salesApi.orderDetail(token, String(saleId)),
  });
}

export function useApproveQrOrder() {
  const { session } = useAuth();
  const token = session?.accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => salesApi.approvePublicOrderBatch(token, batchId),
    onSuccess: (_data, batchId) => {
      qc.invalidateQueries({ queryKey: ['qr-orders'] });
      qc.invalidateQueries({ queryKey: ['qr-order-detail', batchId] });
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
      salesApi.rejectPublicOrderBatch(token, args.saleId, { reason: args.reason ?? null }),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ['qr-orders'] });
      qc.invalidateQueries({ queryKey: ['qr-order-detail', args.saleId] });
      qc.invalidateQueries({ queryKey: ['pos-order-customer-waiting'] });
      qc.invalidateQueries({ queryKey: ['pos-order-feed'] });
    },
  });
}
