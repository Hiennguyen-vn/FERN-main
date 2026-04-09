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
});
