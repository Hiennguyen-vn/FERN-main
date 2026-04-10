import { afterEach, describe, expect, it, vi } from 'vitest';
import { salesApi } from '@/api/fern-api';

describe('salesApi promotions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes promotion fields needed by catalog and promotions surfaces', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [{
          id: '3477396279284207616',
          name: 'Catalog Promo Smoke',
          promoType: 'percentage',
          status: 'draft',
          valueAmount: null,
          valuePercent: 10,
          minOrderAmount: 5,
          maxDiscountAmount: 2,
          effectiveFrom: '2026-04-10T10:00:00Z',
          effectiveTo: '2026-04-20T10:00:00Z',
          outletIds: [2001],
        }],
        limit: 20,
        offset: 0,
        total: 1,
        hasMore: false,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const page = await salesApi.promotions('token', { outletId: '2001', limit: 20, offset: 0 });

    expect(page.items[0]).toMatchObject({
      id: '3477396279284207616',
      name: 'Catalog Promo Smoke',
      promoType: 'percentage',
      status: 'draft',
      valuePercent: 10,
      minOrderAmount: 5,
      maxDiscountAmount: 2,
      effectiveFrom: '2026-04-10T10:00:00Z',
      effectiveTo: '2026-04-20T10:00:00Z',
      outletIds: ['2001'],
    });
  });

  it('sends create promotion payload without dropping scoped fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '3477396279284207616' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await salesApi.createPromotion('token', {
      name: 'Happy Hour',
      promoType: 'percentage',
      valuePercent: 15,
      valueAmount: null,
      minOrderAmount: 5,
      maxDiscountAmount: 2,
      effectiveFrom: '2026-04-10T10:00:00Z',
      effectiveTo: '2026-04-20T10:00:00Z',
      outletIds: [2001],
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({
      name: 'Happy Hour',
      promoType: 'percentage',
      valuePercent: 15,
      valueAmount: null,
      minOrderAmount: 5,
      maxDiscountAmount: 2,
      effectiveFrom: '2026-04-10T10:00:00Z',
      effectiveTo: '2026-04-20T10:00:00Z',
      outletIds: [2001],
    });
  });
});

describe('salesApi POS payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves bigint-safe string ids when opening a POS session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '3477604000000000000' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await salesApi.openPosSession('token', {
      sessionCode: 'POS-20260410-123',
      outletId: '3477603326876991488',
      currencyCode: 'USD',
      managerId: '3477603326876991499',
      businessDate: '2026-04-10',
      note: null,
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({
      sessionCode: 'POS-20260410-123',
      outletId: '3477603326876991488',
      currencyCode: 'USD',
      managerId: '3477603326876991499',
      businessDate: '2026-04-10',
      note: null,
    });
  });

  it('preserves bigint-safe string ids when creating a POS order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '3477605000000000000' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await salesApi.createOrder('token', {
      outletId: '3477603326876991488',
      posSessionId: '3477606000000000001',
      currencyCode: 'USD',
      orderType: 'takeaway',
      note: null,
      items: [{
        productId: '3477607000000000002',
        quantity: 1,
        discountAmount: 0,
        taxAmount: 0,
        note: null,
        promotionIds: ['3477608000000000003'],
      }],
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({
      outletId: '3477603326876991488',
      posSessionId: '3477606000000000001',
      currencyCode: 'USD',
      orderType: 'takeaway',
      note: null,
      items: [{
        productId: '3477607000000000002',
        quantity: 1,
        discountAmount: 0,
        taxAmount: 0,
        note: null,
        promotionIds: ['3477608000000000003'],
      }],
    });
  });
});
