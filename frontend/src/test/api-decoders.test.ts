import { afterEach, describe, expect, it, vi } from 'vitest';
import { authApi, orgApi, salesApi } from '@/api/fern-api';
import { COOKIE_AUTH_TOKEN_SENTINEL } from '@/auth/session';

describe('domain API decoders', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes auth session payloads into cookie-backed sessions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        sessionId: 'sess-1',
        user: {
          id: 101,
          username: 'alice',
          fullName: 'Alice Nguyen',
          email: 'alice@example.com',
          status: 'active',
        },
        rolesByOutlet: { 1001: ['admin'] },
        permissionsByOutlet: { 1001: ['sales.order.write'] },
        issuedAt: '2026-04-09T10:00:00Z',
        expiresAt: '2026-04-09T12:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));

    const session = await authApi.me();

    expect(session.accessToken).toBe(COOKIE_AUTH_TOKEN_SENTINEL);
    expect(session.sessionId).toBe('sess-1');
    expect(session.user.id).toBe('101');
    expect(session.rolesByOutlet['1001']).toEqual(['admin']);
    expect(session.permissionsByOutlet['1001']).toEqual(['sales.order.write']);
    expect(session.expiresAt).toBe(new Date('2026-04-09T12:00:00Z').toISOString());
  });

  it('decodes organization hierarchy lists with normalized ids and strings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        regions: [{ id: 7, code: 'R7', name: 'South' }],
        outlets: [{ id: 101, regionId: 7, code: 'SG01', name: 'Saigon 1', status: 'active', address: null }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));

    const hierarchy = await orgApi.hierarchy(COOKIE_AUTH_TOKEN_SENTINEL);

    expect(hierarchy.regions[0]).toMatchObject({ id: '7', code: 'R7', name: 'South' });
    expect(hierarchy.outlets[0]).toMatchObject({
      id: '101',
      regionId: '7',
      code: 'SG01',
      name: 'Saigon 1',
      status: 'active',
    });
  });

  it('decodes outlet stats with nested hourly revenue values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        outletId: 101,
        businessDate: '2026-04-09',
        ordersToday: 42,
        completedSales: 37,
        cancelledOrders: 5,
        revenueToday: 1250.5,
        averageOrderValue: 33.8,
        activeSessionCode: 'POS-101',
        activeSessionStatus: 'open',
        topCategory: 'Coffee',
        peakHour: '09:00',
        hourlyRevenue: [{ hour: '09:00', revenue: 420.75 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));

    const stats = await salesApi.outletStats(COOKIE_AUTH_TOKEN_SENTINEL, '101');

    expect(stats.outletId).toBe('101');
    expect(stats.ordersToday).toBe(42);
    expect(stats.hourlyRevenue).toEqual([{ hour: '09:00', revenue: 420.75 }]);
    expect(stats.activeSessionStatus).toBe('open');
  });
});
