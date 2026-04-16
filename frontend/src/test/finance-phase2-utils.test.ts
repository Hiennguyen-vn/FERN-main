import { describe, expect, it } from 'vitest';
import type { SaleListItemView, ScopeOutlet } from '@/api/fern-api';
import {
  buildFinancePeriodOptions,
  buildRevenueSnapshot,
  getFinanceVarianceStatus,
} from '@/components/finance/finance-phase2-utils';

const OUTLETS: ScopeOutlet[] = [
  {
    id: '2001',
    regionId: '1001',
    code: 'HCM-01',
    name: 'Saigon Central',
    status: 'active',
  },
  {
    id: '2002',
    regionId: '1001',
    code: 'HCM-02',
    name: 'District 7',
    status: 'active',
  },
];

const ORDERS: SaleListItemView[] = [
  {
    id: '1',
    outletId: '2001',
    status: 'completed',
    orderType: 'dine_in',
    currencyCode: 'VND',
    subtotal: 120000,
    discount: 10000,
    totalAmount: 110000,
    createdAt: '2026-04-12T08:00:00Z',
    payment: { paymentMethod: 'cash', amount: 110000 },
    items: [],
  },
  {
    id: '2',
    outletId: '2002',
    status: 'payment_done',
    orderType: 'delivery',
    currencyCode: 'VND',
    subtotal: 180000,
    discount: 0,
    totalAmount: 180000,
    createdAt: '2026-04-13T10:00:00Z',
    payment: { paymentMethod: 'card', amount: 180000 },
    items: [],
  },
  {
    id: '3',
    outletId: '2002',
    status: 'cancelled',
    orderType: 'delivery',
    currencyCode: 'VND',
    subtotal: 70000,
    discount: 0,
    totalAmount: 70000,
    createdAt: '2026-04-14T10:00:00Z',
    payment: null,
    items: [],
  },
  {
    id: '4',
    outletId: '2001',
    status: 'completed',
    orderType: 'takeaway',
    currencyCode: 'VND',
    subtotal: 90000,
    discount: 0,
    totalAmount: 90000,
    createdAt: '2026-03-28T08:00:00Z',
    payment: { paymentMethod: 'cash', amount: 90000 },
    items: [],
  },
];

describe('finance phase 2 utilities', () => {
  it('builds descending period options from sales timestamps', () => {
    expect(buildFinancePeriodOptions(ORDERS)).toEqual([
      { key: '2026-04', label: 'April 2026' },
      { key: '2026-03', label: 'March 2026' },
    ]);
  });

  it('aggregates revenue snapshot by period and channel', () => {
    const snapshot = buildRevenueSnapshot({
      orders: ORDERS,
      visibleOutlets: OUTLETS,
      periodKey: '2026-04',
      channelFilter: 'all',
    });

    expect(snapshot.currency).toBe('VND');
    expect(snapshot.grossSales).toBe(300000);
    expect(snapshot.discounts).toBe(10000);
    expect(snapshot.netSales).toBe(290000);
    expect(snapshot.voids).toBe(70000);
    expect(snapshot.completedOrderCount).toBe(2);
    expect(snapshot.paymentMix.map((row) => [row.label, row.amount])).toEqual([
      ['Card', 180000],
      ['Cash', 110000],
    ]);
    expect(snapshot.outletRows.map((row) => [row.outletCode, row.netSales, row.voids])).toEqual([
      ['HCM-02', 180000, 70000],
      ['HCM-01', 110000, 0],
    ]);
  });

  it('filters revenue snapshot by selected channel', () => {
    const snapshot = buildRevenueSnapshot({
      orders: ORDERS,
      visibleOutlets: OUTLETS,
      periodKey: '2026-04',
      channelFilter: 'delivery',
    });

    expect(snapshot.netSales).toBe(180000);
    expect(snapshot.completedOrderCount).toBe(1);
    expect(snapshot.channelMix.map((row) => row.label)).toEqual(['Delivery']);
  });

  it('classifies finance variance thresholds consistently', () => {
    expect(getFinanceVarianceStatus(28, 14, 500000)).toBe('clear');
    expect(getFinanceVarianceStatus(36, 14, 500000)).toBe('watch');
    expect(getFinanceVarianceStatus(41, 14, 500000)).toBe('risk');
    expect(getFinanceVarianceStatus(null, null, 0)).toBe('no-sales');
  });
});
