import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, toPagedResponse } from '@/api/client';
import { COOKIE_AUTH_TOKEN_SENTINEL } from '@/auth/session';

describe('apiRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses cookie-backed credentials without emitting a bearer header for sentinel tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/v1/auth/me', { token: COOKIE_AUTH_TOKEN_SENTINEL });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options?.credentials).toBe('include');
    expect((options?.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('toPagedResponse', () => {
  it('maps standard paged payloads', () => {
    const page = toPagedResponse<{ id: number }>({
      items: [{ id: 1 }],
      limit: 25,
      offset: 0,
      total: 1,
      hasMore: false,
    });

    expect(page.items).toEqual([{ id: 1 }]);
    expect(page.totalCount).toBe(1);
    expect(page.hasNextPage).toBe(false);
  });

  it('throws for invalid payload shapes instead of masking them as empty state', () => {
    expect(() => toPagedResponse({ data: [] })).toThrow('Expected paged response shape');
    expect(() => toPagedResponse(null)).toThrow('Expected paged response object or array');
  });
});
