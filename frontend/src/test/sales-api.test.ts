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

describe('salesApi public ordering endpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes public table and menu responses for the customer route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          tableToken: 'tbl_hcm1_u7k29q',
          tableCode: 'T1',
          tableName: 'Table 1',
          status: 'active',
          outletCode: 'VN-HCM-001',
          outletName: 'Saigon Central Outlet',
          currencyCode: 'VND',
          timezoneName: 'Asia/Ho_Chi_Minh',
          businessDate: '2026-04-11',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            productId: '5000',
            code: 'LATTE',
            name: 'Cafe Latte',
            categoryCode: 'beverage',
            description: null,
            imageUrl: null,
            priceValue: 65000.00,
            currencyCode: 'VND',
          },
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const table = await salesApi.getPublicTable('tbl_hcm1_u7k29q');
    const menu = await salesApi.listPublicMenu('tbl_hcm1_u7k29q');

    expect(table).toMatchObject({
      tableToken: 'tbl_hcm1_u7k29q',
      tableCode: 'T1',
      tableName: 'Table 1',
      outletCode: 'VN-HCM-001',
      outletName: 'Saigon Central Outlet',
      currencyCode: 'VND',
      businessDate: '2026-04-11',
    });
    expect(menu).toEqual([
      expect.objectContaining({
        productId: '5000',
        code: 'LATTE',
        name: 'Cafe Latte',
        categoryCode: 'beverage',
        priceValue: 65000,
        currencyCode: 'VND',
      }),
    ]);
  });

  it('preserves public order payload shape and decodes the receipt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        orderToken: 'ord_public_123',
        tableCode: 'T1',
        tableName: 'Table 1',
        outletCode: 'VN-HCM-001',
        outletName: 'Saigon Central Outlet',
        currencyCode: 'VND',
        orderStatus: 'order_created',
        paymentStatus: 'pending',
        totalAmount: 130000,
        note: 'no sugar',
        createdAt: '2026-04-11T12:34:00Z',
        items: [{
          productId: '5000',
          productCode: 'LATTE',
          productName: 'Cafe Latte',
          quantity: 2,
          unitPrice: 65000,
          lineTotal: 130000,
          note: 'less ice',
        }],
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const receipt = await salesApi.createPublicOrder('tbl_hcm1_u7k29q', {
      note: 'no sugar',
      items: [{ productId: '5000', quantity: 2, note: 'less ice' }],
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({
      note: 'no sugar',
      items: [{ productId: '5000', quantity: 2, note: 'less ice' }],
    });
    expect(receipt).toMatchObject({
      orderToken: 'ord_public_123',
      orderStatus: 'order_created',
      paymentStatus: 'pending',
      totalAmount: 130000,
      items: [{
        productId: '5000',
        productCode: 'LATTE',
        productName: 'Cafe Latte',
        quantity: 2,
        unitPrice: 65000,
        lineTotal: 130000,
        note: 'less ice',
      }],
    });
  });
});

describe('salesApi staff customer order list', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes public order metadata from the staff order queue', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [{
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
          items: [{
            productId: '5000',
            quantity: 2,
            unitPrice: 60000,
            discountAmount: 0,
            taxAmount: 0,
            lineTotal: 120000,
            note: 'Less ice',
          }],
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

    const page = await salesApi.orders('token', {
      outletId: '3477603326876991488',
      publicOrderOnly: true,
      limit: 20,
      offset: 0,
    });

    expect(page.items[0]).toMatchObject({
      id: '3478000000000000001',
      publicOrderToken: 'pub_ord_token_123',
      orderingTableCode: 'T1',
      orderingTableName: 'Table 1',
      currencyCode: 'VND',
      note: 'No sugar',
      items: [{
        productId: '5000',
        quantity: 2,
        unitPrice: 60000,
        lineTotal: 120000,
        note: 'Less ice',
      }],
    });
  });
});
