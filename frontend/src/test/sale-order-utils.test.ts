import { describe, expect, it } from 'vitest';
import type { SaleDetailView, SaleListItemView } from '@/api/fern-api';
import { mapSaleToUi } from '@/components/pos/sale-order-utils';

describe('sale-order-utils', () => {
  it('maps customer table orders into the staff queue detail model', () => {
    const sale: SaleListItemView = {
      id: '3478000000000000001',
      outletId: '3477603326876991488',
      posSessionId: null,
      publicOrderToken: 'pub_ord_token_123',
      status: 'order_created',
      paymentStatus: 'pending',
      orderType: 'dine_in',
      orderingTableCode: 'T1',
      orderingTableName: 'Table 1',
      currencyCode: 'VND',
      subtotal: 120000,
      discount: 0,
      taxAmount: 0,
      totalAmount: 120000,
      note: 'No sugar',
      createdAt: '2026-04-11T12:34:00Z',
      items: [],
      payment: null,
    };

    const detail: SaleDetailView = {
      ...sale,
      items: [{
        productId: '5000',
        quantity: 2,
        unitPrice: 60000,
        lineTotal: 120000,
        note: 'Less ice',
      }],
      payment: null,
    };

    const mapped = mapSaleToUi(
      sale,
      detail,
      'VN-HCM-001 · Saigon Central Outlet',
      'Cashier One',
      new Map(),
      new Map([['5000', 'Cafe Latte']]),
    );

    expect(mapped).toMatchObject({
      orderNumber: 'QR-en_123',
      sourceLabel: 'Customer table order',
      publicOrderToken: 'pub_ord_token_123',
      tableNumber: 'T1',
      tableName: 'Table 1',
      createdBy: 'Customer QR/table',
      currencyCode: 'VND',
      note: 'No sugar',
      total: 120000,
      lineItems: [{
        productId: '5000',
        productName: 'Cafe Latte',
        quantity: 2,
        lineTotal: 120000,
        note: 'Less ice',
      }],
    });
  });
});
