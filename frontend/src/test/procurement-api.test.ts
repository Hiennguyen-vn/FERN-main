import { afterEach, describe, expect, it, vi } from 'vitest';
import { procurementApi } from '@/api/fern-api';

describe('procurementApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes supplier list responses returned in paged shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          {
            id: 6000,
            supplierCode: 'SUP-COFFEE-001',
            name: 'Global Coffee Supply',
            status: 'active',
          },
        ],
        limit: 50,
        offset: 0,
        totalCount: 1,
        hasNextPage: false,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const suppliers = await procurementApi.suppliers('token');

    expect(suppliers).toEqual([
      expect.objectContaining({
        id: '6000',
        supplierCode: 'SUP-COFFEE-001',
        name: 'Global Coffee Supply',
        status: 'active',
      }),
    ]);
  });
});
