import { describe, expect, it } from 'vitest';
import type {
  DailyRevenueRow,
  PosSessionView,
  ScopeOutlet,
  StockBalanceView,
} from '@/api/fern-api';
import { buildRegionalOpsSnapshot } from '@/components/reports/regional-ops-utils';

const OUTLETS: ScopeOutlet[] = [
  { id: '2001', regionId: '1001', code: 'HCM-01', name: 'Saigon Central', status: 'active', currencyCode: 'VND' },
  { id: '2002', regionId: '1001', code: 'HCM-02', name: 'District 7', status: 'active', currencyCode: 'VND' },
  { id: '2003', regionId: '1001', code: 'HCM-03', name: 'Airport', status: 'active', currencyCode: 'VND' },
];

const DAILY_ROWS: DailyRevenueRow[] = [
  {
    outletId: '2001',
    businessDate: '2026-04-12',
    orderCount: 3,
    cancelledCount: 0,
    grossSales: 450000,
    discounts: 50000,
    netSales: 400000,
    taxAmount: 0,
    totalAmount: 400000,
    voids: 0,
    currencyCode: 'VND',
    paymentMix: [],
    channelMix: [],
    paymentCodedOrders: 0,
  },
  {
    outletId: '2002',
    businessDate: '2026-04-12',
    orderCount: 1,
    cancelledCount: 0,
    grossSales: 100000,
    discounts: 0,
    netSales: 100000,
    taxAmount: 0,
    totalAmount: 100000,
    voids: 0,
    currencyCode: 'VND',
    paymentMix: [],
    channelMix: [],
    paymentCodedOrders: 0,
  },
];

const SESSIONS: PosSessionView[] = [
  { id: 's1', outletId: '2001', status: 'open' },
  { id: 's2', outletId: '2001', status: 'closed' },
  { id: 's3', outletId: '2002', status: 'open' },
];

const LOW_BALANCES = new Map<string, StockBalanceView[]>([
  ['2001', [{ outletId: '2001', itemId: 'i1', qtyOnHand: 0 }, { outletId: '2001', itemId: 'i2', qtyOnHand: 2 }]],
  ['2002', []],
  ['2003', [{ outletId: '2003', itemId: 'i3', qtyOnHand: 0 }]],
]);

describe('regional ops utilities', () => {
  it('keeps zero-sales outlets in the scorecard and aggregates operational signals', () => {
    const snapshot = buildRegionalOpsSnapshot({
      outlets: OUTLETS,
      dailyRows: DAILY_ROWS,
      sessions: SESSIONS,
      lowBalancesByOutlet: LOW_BALANCES,
    });

    expect(snapshot.currency).toBe('VND');
    expect(snapshot.netSales).toBe(500000);
    expect(snapshot.orderCount).toBe(4);
    expect(snapshot.outletsInScope).toBe(3);
    expect(snapshot.outletsWithSales).toBe(2);
    expect(snapshot.activeSessions).toBe(2);
    expect(snapshot.outOfStockCount).toBe(2);
    expect(snapshot.lowStockCount).toBe(1);
    expect(snapshot.outletRows.map((row) => [row.outletCode, row.netSales, row.orderCount])).toEqual([
      ['HCM-01', 400000, 3],
      ['HCM-02', 100000, 1],
      ['HCM-03', 0, 0],
    ]);
  });
});
