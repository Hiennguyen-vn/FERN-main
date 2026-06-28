import type { SaleListItemView } from '@/api/sales-api';
import {
  getCustomerOrderQueueFilter,
  type CustomerOrderQueueFilter,
} from '@/components/pos/customer-order-queue';

function tableKey(order: SaleListItemView) {
  return String(order.orderingTableCode || order.orderingTableName || 'unknown').trim();
}

function approvedGroupKey(order: SaleListItemView) {
  if (order.saleId) return `sale:${order.saleId}`;
  return `table:${tableKey(order)}`;
}

/** Approved/paid QR batches for one table share one open sale — show one payable row per table check. */
export function groupOrdersForQueueFilter(
  orders: SaleListItemView[],
  filter: CustomerOrderQueueFilter,
): SaleListItemView[] {
  if (filter !== 'approved' && filter !== 'paid') {
    return orders;
  }

  const groups = new Map<string, SaleListItemView>();
  for (const order of orders) {
    if (getCustomerOrderQueueFilter(order) !== filter) continue;

    const key = approvedGroupKey(order);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...order,
        id: order.saleId ? String(order.saleId) : key,
        batchCount: 1,
      });
      continue;
    }

    const batchCount = Number(existing.batchCount ?? 1) + 1;
    const createdAt = [existing.createdAt, order.createdAt]
      .filter(Boolean)
      .sort()
      .at(-1) ?? existing.createdAt;

    groups.set(key, {
      ...existing,
      batchCount,
      createdAt,
      note: existing.note || order.note,
    });
  }

  return Array.from(groups.values()).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  );
}

export function countQrQueueOrders(orders: SaleListItemView[]) {
  const counts = { all: orders.length, waiting: 0, approved: 0, paid: 0, cancelled: 0 };
  const approvedKeys = new Set<string>();
  const paidKeys = new Set<string>();

  for (const order of orders) {
    const filter = getCustomerOrderQueueFilter(order);
    if (filter === 'approved') {
      approvedKeys.add(approvedGroupKey(order));
    } else if (filter === 'paid') {
      paidKeys.add(approvedGroupKey(order));
    } else if (filter in counts) {
      counts[filter] += 1;
    }
  }

  counts.approved = approvedKeys.size;
  counts.paid = paidKeys.size;
  return counts;
}
