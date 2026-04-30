import { afterEach, describe, expect, it, vi } from 'vitest';
import { orgApi } from '@/api/fern-api';

describe('orgApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends outlet lifecycle changes to the dedicated status endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: '3484207602558582786',
        regionId: '10',
        code: 'SIM-TODAY-OUT-0001',
        name: 'Simulator Outlet',
        status: 'closed',
        closedAt: '2026-04-29',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const outlet = await orgApi.updateOutletStatus('token-1', '3484207602558582786', {
      targetStatus: 'closed',
      reason: 'End of operations',
    });

    expect(outlet).toMatchObject({
      id: '3484207602558582786',
      status: 'closed',
      closedAt: '2026-04-29',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/v1/org/outlets/3484207602558582786/status');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({
      targetStatus: 'closed',
      reason: 'End of operations',
    });
  });
});
