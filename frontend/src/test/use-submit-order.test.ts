import { describe, expect, it } from 'vitest';
import { computePromotionDiscount } from '@/routes/pos-order/utils/promo-voucher';
import {
  isRecoverableSubmitPhase,
  listRecoverablePending,
} from '@/routes/pos-order/hooks/use-submit-order';

describe('computePromotionDiscount', () => {
  it('applies percent discount with min order guard', () => {
    const discount = computePromotionDiscount({
      id: '1',
      valuePercent: 10,
      minOrderAmount: 100000,
    }, 250000);
    expect(discount).toBe(25000);
  });

  it('returns zero when order is below minimum', () => {
    const discount = computePromotionDiscount({
      id: '2',
      valueAmount: 50000,
      minOrderAmount: 200000,
    }, 150000);
    expect(discount).toBe(0);
  });
});

describe('pending submit recovery helpers', () => {
  it('marks failed and in-flight phases as recoverable', () => {
    expect(isRecoverableSubmitPhase('payment_failed')).toBe(true);
    expect(isRecoverableSubmitPhase('paid')).toBe(false);
    expect(isRecoverableSubmitPhase('idle')).toBe(false);
  });

  it('lists only recoverable snapshots for the active outlet', () => {
    const storage = {
      values: new Map<string, string>(),
      get length() { return this.values.size; },
      clear() { this.values.clear(); },
      getItem(key: string) { return this.values.get(key) ?? null; },
      key(index: number) { return [...this.values.keys()][index] ?? null; },
      removeItem(key: string) { this.values.delete(key); },
      setItem(key: string, value: string) { this.values.set(key, value); },
    } as Storage;

    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: storage });

    storage.setItem('pos-order-pending-a', JSON.stringify({
      idempotencyKey: 'a',
      phase: 'payment_failed',
      outletId: '10',
      currencyCode: 'VND',
      createdAt: '2026-06-24T10:00:00Z',
      lines: [],
      previewTotal: 100000,
      method: 'cash',
      orderType: 'dinein',
    }));
    storage.setItem('pos-order-pending-b', JSON.stringify({
      idempotencyKey: 'b',
      phase: 'paid',
      outletId: '10',
      currencyCode: 'VND',
      createdAt: '2026-06-24T11:00:00Z',
      lines: [],
      previewTotal: 50000,
      method: 'cash',
      orderType: 'takeaway',
    }));

    expect(listRecoverablePending('10').map((item) => item.idempotencyKey)).toEqual(['a']);
  });
});
