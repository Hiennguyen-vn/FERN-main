import { describe, expect, it } from 'vitest';
import type { SaleListItemView } from '@/api/sales-api';
import { countQrQueueOrders, groupOrdersForQueueFilter } from '@/routes/pos-order/utils/qr-queue-grouping';

function batch(id: string, saleId: string | null, status = 'order_approved'): SaleListItemView {
  return {
    id,
    saleId,
    status,
    paymentStatus: 'unpaid',
    orderingTableCode: 'T01',
    orderingTableName: 'Table 1',
    totalAmount: 29000,
    items: [{ productId: '1', quantity: 1, unitPrice: 29000, lineTotal: 29000 }],
  };
}

describe('qr-queue-grouping', () => {
  it('groups approved batches by sale into one payable table check', () => {
    const orders = [
      batch('batch-1', 'sale-1'),
      batch('batch-2', 'sale-1'),
    ];
    const grouped = groupOrdersForQueueFilter(orders, 'approved');
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe('sale-1');
    expect(grouped[0].batchCount).toBe(2);
  });

  it('counts approved rows by unique table sale', () => {
    const orders = [
      batch('batch-1', 'sale-1'),
      batch('batch-2', 'sale-1'),
      batch('batch-3', 'sale-2'),
    ];
    expect(countQrQueueOrders(orders).approved).toBe(2);
  });
});
