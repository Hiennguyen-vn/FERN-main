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
