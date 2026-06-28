import { describe, expect, it } from 'vitest';
import { shouldFetchPendingFeed } from '@/routes/pos-order/hooks/use-pos-order-feeds';

describe('shouldFetchPendingFeed', () => {
  it('does not fetch pending orders without an open session', () => {
    expect(shouldFetchPendingFeed({ sessionReady: false, drawerScope: 'pending', closeShiftOpen: true })).toBe(false);
  });

  it('fetches pending orders when the pending drawer is open', () => {
    expect(shouldFetchPendingFeed({ sessionReady: true, drawerScope: 'pending', closeShiftOpen: false })).toBe(true);
  });

  it('fetches pending orders when close-shift dialog is open', () => {
    expect(shouldFetchPendingFeed({ sessionReady: true, drawerScope: null, closeShiftOpen: true })).toBe(true);
  });

  it('skips pending fetch for today drawer only', () => {
    expect(shouldFetchPendingFeed({ sessionReady: true, drawerScope: 'today', closeShiftOpen: false })).toBe(false);
  });
});
