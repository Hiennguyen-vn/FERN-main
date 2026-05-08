import { afterEach, describe, expect, it, vi } from 'vitest';
import { inventoryApi } from '@/api/fern-api';

describe('inventoryApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not send qty when creating waste records', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await inventoryApi.createWaste('token', {
      outletId: '2001',
      itemId: '4000',
      qty: 0.25,
      quantity: 0.25,
      businessDate: '2026-04-10',
      reason: 'Spoilage',
      note: 'Damaged during storage',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      outletId: '2001',
      itemId: '4000',
      quantity: 0.25,
      businessDate: '2026-04-10',
      reason: 'Spoilage',
      note: 'Damaged during storage',
    });
    expect(body.qty).toBeUndefined();
  });

  it('does not send businessDate when creating stock count sessions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await inventoryApi.createStockCountSession('token', {
      outletId: '2001',
      countDate: '2026-04-10',
      businessDate: '2026-04-10',
      note: 'cycle count',
      lines: [{ itemId: '4000', actualQty: 10, note: 'manual count' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      outletId: '2001',
      countDate: '2026-04-10',
      note: 'cycle count',
      lines: [{ itemId: '4000', actualQty: 10, note: 'manual count' }],
    });
    expect(body.businessDate).toBeUndefined();
  });

  it('decodes stock count session detail lines for review flows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: '3477372999328337921',
        outletId: 2001,
        countDate: '2026-04-10',
        status: 'draft',
        note: 'cycle count',
        totalItems: 1,
        countedItems: 1,
        varianceItems: 1,
        varianceValue: -14.244,
        lines: [
          {
            id: '3477372999357698048',
            itemId: 4000,
            systemQty: 24.244,
            actualQty: 10,
            varianceQty: -14.244,
            note: 'manual verify',
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = await inventoryApi.getStockCountSession('token', '3477372999328337921');

    expect(session.id).toBe('3477372999328337921');
    expect(session.totalItems).toBe(1);
    expect(session.lines).toHaveLength(1);
    expect(session.lines?.[0]).toMatchObject({
      itemId: '4000',
      systemQty: 24.244,
      actualQty: 10,
      varianceQty: -14.244,
      note: 'manual verify',
    });
  });

  it('decodes waste transaction reason for waste history views', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          {
            id: '1',
            outletId: 2001,
            itemId: 4000,
            txnType: 'waste_out',
            qtyChange: -0.5,
            businessDate: '2026-04-10',
            txnTime: '2026-04-10T09:30:00Z',
            wasteReason: 'Spoilage',
            note: 'Damaged during storage',
          },
        ],
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

    const page = await inventoryApi.transactions('token', { outletId: '2001', txnType: 'waste_out' });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      txnType: 'waste_out',
      wasteReason: 'Spoilage',
      note: 'Damaged during storage',
    });
  });

  it('loads all paginated stock balance pages for POS menu availability checks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [
            {
              outletId: 2001,
              itemId: 4000,
              itemName: 'Pho Broth',
              qtyOnHand: 8942,
              unitCost: 15,
              baseUomCode: 'ml',
            },
            {
              outletId: 2001,
              itemId: 4001,
              itemName: 'Pho Noodles',
              qtyOnHand: 4410,
              unitCost: 20,
              baseUomCode: 'g',
            },
          ],
          limit: 2,
          offset: 0,
          total: 3,
          hasMore: true,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [
            {
              outletId: 2001,
              itemId: 4002,
              itemName: 'Bean Sprouts',
              qtyOnHand: 206,
              unitCost: 10,
              baseUomCode: 'g',
            },
          ],
          limit: 2,
          offset: 2,
          total: 3,
          hasMore: false,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const balances = await inventoryApi.balances('token', '2001');

    expect(balances).toHaveLength(3);
    expect(balances[0]).toMatchObject({
      outletId: '2001',
      itemId: '4000',
      itemName: 'Pho Broth',
      qtyOnHand: 8942,
      unitCode: 'ml',
    });
    expect(balances[2]).toMatchObject({
      itemId: '4002',
      itemName: 'Bean Sprouts',
      qtyOnHand: 206,
      unitCode: 'g',
    });

    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost');
    expect(firstUrl.searchParams.get('limit')).toBe('200');
    expect(firstUrl.searchParams.get('offset')).toBe('0');
    expect(secondUrl.searchParams.get('offset')).toBe('2');
  });
});
