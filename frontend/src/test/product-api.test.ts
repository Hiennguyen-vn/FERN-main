import { afterEach, describe, expect, it, vi } from 'vitest';
import { productApi } from '@/api/fern-api';

describe('productApi', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('normalizes seeded defaults when creating products and items', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
    vi.stubGlobal('fetch', fetchMock);

    await productApi.createProduct('token', {
      code: 'NEW-PRODUCT',
      name: 'New Product',
      categoryCode: ' beverage ',
    });
    await productApi.createItem('token', {
      code: 'NEW-ITEM',
      name: 'New Item',
      categoryCode: ' ingredient ',
      unitCode: '',
    });

    const [, productOptions] = fetchMock.mock.calls[0];
    const [, itemOptions] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(productOptions?.body))).toMatchObject({
      code: 'NEW-PRODUCT',
      name: 'New Product',
      categoryCode: 'beverage',
    });
    expect(JSON.parse(String(itemOptions?.body))).toMatchObject({
      code: 'NEW-ITEM',
      name: 'New Item',
      categoryCode: 'ingredient',
      baseUomCode: 'kg',
    });
  });

  it('maps recipe payloads to the backend contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ productId: 5000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await productApi.upsertRecipe('token', '5000', {
      version: 'v2',
      yieldQty: 1,
      yieldUomCode: 'cup',
      status: 'active',
      items: [{ itemId: '4000', qtyRequired: 0.018, uomCode: 'kg' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({
      version: 'v2',
      yieldQty: 1,
      yieldUomCode: 'cup',
      status: 'active',
      items: [{ itemId: 4000, qty: 0.018, uomCode: 'kg' }],
    });
  });

  it('decodes recipe lines and yield fields from backend responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        productId: 5000,
        version: 'v1',
        yieldQty: 1,
        yieldUomCode: 'cup',
        status: 'active',
        items: [{ itemId: 4000, uomCode: 'kg', qty: 0.018 }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const recipe = await productApi.recipe('token', '5000');

    expect(recipe).toMatchObject({
      productId: '5000',
      version: 'v1',
      yieldQty: 1,
      yieldUomCode: 'cup',
      status: 'active',
    });
    expect(recipe.items?.[0]).toMatchObject({
      itemId: '4000',
      uomCode: 'kg',
      qtyRequired: 0.018,
    });
  });

  it('loads all price pages for an outlet instead of stopping at the first page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [{
            productId: 5000,
            outletId: 2001,
            currencyCode: 'VND',
            priceValue: 45000,
          }, {
            productId: 5001,
            outletId: 2001,
            currencyCode: 'VND',
            priceValue: 55000,
          }],
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
          items: [{
            productId: 5002,
            outletId: 2001,
            currencyCode: 'VND',
            priceValue: 5000,
          }],
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

    const prices = await productApi.prices('token', '2001');

    expect(prices).toHaveLength(3);
    expect(prices.map((price) => price.productId)).toEqual(['5000', '5001', '5002']);

    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost');
    expect(firstUrl.searchParams.get('outletId')).toBe('2001');
    expect(firstUrl.searchParams.get('limit')).toBe('200');
    expect(firstUrl.searchParams.get('offset')).toBe('0');
    expect(secondUrl.searchParams.get('offset')).toBe('2');
  });

  it('sends explicit uppercase currency when setting outlet prices', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ productId: 5000, outletId: 2001, currencyCode: 'VND' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await productApi.upsertPrice('token', {
      productId: '5000',
      outletId: '2001',
      currencyCode: 'vnd',
      priceAmount: 40000,
      effectiveFrom: '2026-05-17',
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options?.body))).toMatchObject({
      productId: 5000,
      outletId: 2001,
      currencyCode: 'VND',
      priceValue: 40000,
      effectiveFrom: '2026-05-17',
    });
  });

  it('uploads product images through the backend multipart endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        finalUrl: '/api/v1/product/product-images?key=products%2F123%2Fproduct.png',
        contentType: 'image/png',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([1])], 'product.png', { type: 'image/png' });
    const result = await productApi.uploadProductImage('token', '123', file);

    expect(result.finalUrl).toBe('/api/v1/product/product-images?key=products%2F123%2Fproduct.png');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/product/products/123/image/upload', expect.objectContaining({
      method: 'POST',
      body: expect.any(FormData),
      credentials: 'include',
    }));
    const [, options] = fetchMock.mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token');
    expect(headers['Content-Type']).toBeUndefined();
    expect((options?.body as FormData).get('file')).toBe(file);
  });

  it('times out stalled product image uploads', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([1])], 'product.png', { type: 'image/png' });
    const upload = productApi.uploadProductImageToS3('https://storage.example/upload', file, 1000);
    const expectation = expect(upload).rejects.toThrow('Image storage upload timed out');

    await vi.advanceTimersByTimeAsync(1000);

    await expectation;
    expect(fetchMock).toHaveBeenCalledWith('https://storage.example/upload', expect.objectContaining({
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'image/png' },
      signal: expect.any(AbortSignal),
    }));
  });
});
