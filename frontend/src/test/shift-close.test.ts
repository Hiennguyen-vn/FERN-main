import { describe, expect, it } from 'vitest';
import {
  buildReconcileLines,
  decodeCashSessionSummary,
  decodePaymentSummary,
  parseUnpaidOrdersError,
  resolveExpectedCashInDrawer,
  resolveOpeningFloat,
} from '@/routes/pos-order/utils/shift-close';

describe('shift-close utils', () => {
  it('decodes cash session summary from backend payload', () => {
    expect(decodeCashSessionSummary({
      openFloat: 500000,
      salesCash: 120000,
      expectedTotal: 620000,
      variance: -5000,
    })).toEqual({
      openFloat: 500000,
      salesCash: 120000,
      paidIn: 0,
      paidOut: 0,
      drops: 0,
      expectedTotal: 620000,
      counted: 0,
      variance: -5000,
    });
  });

  it('prefers backend expected total for drawer cash', () => {
    expect(resolveExpectedCashInDrawer(
      { openFloat: 100, salesCash: 50, paidIn: 0, paidOut: 0, drops: 0, expectedTotal: 145, counted: 0, variance: 0 },
      100,
      50,
    )).toBe(145);
  });

  it('falls back to opening cash plus cash sales when summary is missing', () => {
    expect(resolveExpectedCashInDrawer(null, 200000, 80000)).toBe(280000);
  });

  it('prefers backend open float over sessionStorage fallback', () => {
    expect(resolveOpeningFloat(
      { openFloat: 300000, salesCash: 0, paidIn: 0, paidOut: 0, drops: 0, expectedTotal: 300000, counted: 0, variance: 0 },
      100000,
    )).toBe(300000);
  });

  it('builds reconcile lines with explicit cash count', () => {
    expect(buildReconcileLines([
      { method: 'cash', label: 'Tiền mặt', total: 120000, count: 2 },
      { method: 'ewallet', label: 'QR', total: 50000, count: 1 },
    ], 615000)).toEqual([
      { paymentMethod: 'cash', actualAmount: 615000 },
      { paymentMethod: 'card', actualAmount: 0 },
      { paymentMethod: 'ewallet', actualAmount: 50000 },
      { paymentMethod: 'bank_transfer', actualAmount: 0 },
      { paymentMethod: 'voucher', actualAmount: 0 },
    ]);
  });

  it('parses unpaid order close-shift errors', () => {
    expect(parseUnpaidOrdersError('SESSION_HAS_UNPAID_ORDERS:3')).toBe(3);
    expect(parseUnpaidOrdersError('other')).toBeNull();
  });

  it('decodes session payment summary with normalized methods', () => {
    expect(decodePaymentSummary({
      orderCount: 4,
      totalRevenue: 313200,
      items: [
        { paymentMethod: 'cash', total: 120000, count: 2 },
        { paymentMethod: 'card', total: 193200, count: 2 },
      ],
    })).toEqual({
      orderCount: 4,
      totalRevenue: 313200,
      paymentBreakdown: [
        { method: 'card', label: 'Thẻ', total: 193200, count: 2 },
        { method: 'cash', label: 'Tiền mặt', total: 120000, count: 2 },
      ],
    });
  });
});
