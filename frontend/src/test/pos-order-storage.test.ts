import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { listPendingOrders } from '@/routes/pos-order/hooks/use-submit-order';
import { useDraftOrders } from '@/routes/pos-order/hooks/use-draft-orders';

describe('POS order session storage', () => {
  function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => { values.delete(key); },
      setItem: (key: string, value: string) => { values.set(key, String(value)); },
    } as Storage;
  }

  beforeEach(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('lists pending order snapshots from sessionStorage only', () => {
    window.sessionStorage.setItem('pos-order-pending-session-idem', JSON.stringify({
      idempotencyKey: 'session-idem',
      phase: 'creating',
      outletId: '10',
      currencyCode: 'VND',
      createdAt: '2026-04-28T08:00:00Z',
      lines: [],
      previewTotal: 0,
      method: 'cash',
      orderType: 'dinein',
    }));
    window.localStorage.setItem('pos-order-pending-local-idem', JSON.stringify({
      idempotencyKey: 'local-idem',
      phase: 'creating',
      outletId: '10',
      currencyCode: 'VND',
      createdAt: '2026-04-28T08:00:00Z',
      lines: [],
      previewTotal: 0,
      method: 'cash',
      orderType: 'dinein',
    }));

    expect(listPendingOrders().map((order) => order.idempotencyKey)).toEqual(['session-idem']);
  });

  it('persists draft orders in sessionStorage instead of localStorage', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'draft-1' });
    const { result } = renderHook(() => useDraftOrders());

    act(() => {
      result.current.saveDraft({
        orderNo: '001',
        orderType: 'dinein',
        customerName: 'Lan',
        lines: [],
      });
    });

    expect(window.sessionStorage.getItem('pos-order-drafts-v2')).toContain('draft-1');
    expect(window.localStorage.getItem('pos-order-drafts-v2')).toBeNull();
  });
});
