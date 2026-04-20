import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SaleListItemView } from '@/api/sales-api';
import {
  getCustomerOrderQueueFilter,
  type CustomerOrderQueueFilter,
} from '@/components/pos/customer-order-queue';
import type { PosMenuItem } from '../hooks/use-pos-menu';
import {
  useApproveQrOrder,
  useCancelQrOrder,
  useQrOrderDetail,
  useQrOrders,
} from '../hooks/use-qr-orders';
import { QrQueueSidebar } from './QrQueueSidebar';
import { QrQueueList } from './QrQueueList';
import { QrOrderDetailPanel } from './QrOrderDetailPanel';

interface Props {
  outletId: string;
  outletName: string;
  menu: PosMenuItem[];
  onRequestPayment: (order: SaleListItemView) => void;
}

export function QrQueueView({ outletId, outletName, menu, onRequestPayment }: Props) {
  const [filter, setFilter] = useState<CustomerOrderQueueFilter>('waiting');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const ordersQuery = useQrOrders(outletId);
  const detailQuery = useQrOrderDetail(selectedId);
  const approveMutation = useApproveQrOrder();
  const cancelMutation = useCancelQrOrder();

  const allOrders = ordersQuery.data ?? [];

  const counts = useMemo(() => {
    const c = { all: allOrders.length, waiting: 0, approved: 0, paid: 0, cancelled: 0 };
    for (const o of allOrders) {
      const f = getCustomerOrderQueueFilter(o);
      c[f] += 1;
    }
    return c;
  }, [allOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allOrders.filter((o) => {
      if (filter !== 'all' && getCustomerOrderQueueFilter(o) !== filter) return false;
      if (!q) return true;
      const hay = [
        String(o.id),
        o.orderingTableName,
        o.orderingTableCode,
        o.note,
      ].map((v) => String(v || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }, [allOrders, filter, search]);

  const selectedOrder = detailQuery.data
    ?? allOrders.find((o) => String(o.id) === selectedId)
    ?? null;

  const handleApprove = (saleId: string) => {
    approveMutation.mutate(saleId, {
      onSuccess: () => toast.success('Đã duyệt đơn'),
      onError: (err) => toast.error(`Duyệt thất bại: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  const handleCancel = (saleId: string) => {
    cancelMutation.mutate(
      { saleId },
      {
        onSuccess: () => toast.success('Đã từ chối đơn'),
        onError: (err) => toast.error(`Từ chối thất bại: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  return (
    <>
      <QrQueueSidebar active={filter} counts={counts} onChange={setFilter} outletName={outletName} />
      <QrQueueList
        orders={filtered}
        selectedId={selectedId}
        onSelect={setSelectedId}
        search={search}
        onSearchChange={setSearch}
        isLoading={ordersQuery.isLoading}
        error={ordersQuery.error}
      />
      <QrOrderDetailPanel
        order={selectedOrder}
        isLoading={detailQuery.isLoading}
        menu={menu}
        approveBusy={approveMutation.isPending}
        cancelBusy={cancelMutation.isPending}
        onApprove={handleApprove}
        onCancel={handleCancel}
        onRequestPayment={onRequestPayment}
      />
    </>
  );
}
