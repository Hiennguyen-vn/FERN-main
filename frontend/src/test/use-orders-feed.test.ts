import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrdersFeedQuery } from '@/routes/pos-order/hooks/use-orders-feed';

describe('buildOrdersFeedQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T10:30:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scopes today paid orders to the current POS session without calendar dates', () => {
    expect(buildOrdersFeedQuery('today', '42', 'session-9')).toEqual({
      outletId: '42',
      limit: 50,
      sortBy: 'createdAt',
      sortDir: 'desc',
      paymentStatus: 'paid',
      posSessionId: 'session-9',
    });
  });

  it('scopes pending unpaid orders to the current POS session', () => {
    expect(buildOrdersFeedQuery('pending', '42', 'session-9')).toEqual({
      outletId: '42',
      limit: 50,
      sortBy: 'createdAt',
      sortDir: 'desc',
      paymentStatus: 'unpaid',
      posSessionId: 'session-9',
    });
  });

  it('uses local calendar day when no session is active', () => {
    const query = buildOrdersFeedQuery('today', '42', null);
    expect(query.posSessionId).toBeUndefined();
    expect(query.paymentStatus).toBe('paid');
    expect(query.startDate).toBe('2026-06-28');
    expect(query.endDate).toBe('2026-06-28');
  });
});
