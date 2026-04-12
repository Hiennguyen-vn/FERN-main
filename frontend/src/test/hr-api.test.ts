import { afterEach, describe, expect, it, vi } from 'vitest';
import { hrApi } from '@/api/fern-api';

describe('hr api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unwraps paged shift catalogs and requests a stable time-based sort', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          {
            id: 5100,
            outletId: 101,
            code: 'AM',
            name: 'Morning Shift',
            startTime: '08:00:00',
            endTime: '16:00:00',
            breakMinutes: 30,
          },
        ],
        limit: 200,
        offset: 0,
        total: 1,
        hasMore: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const shifts = await hrApi.shifts('token-1', '101');

    expect(shifts).toEqual([
      expect.objectContaining({
        id: '5100',
        outletId: '101',
        code: 'AM',
        name: 'Morning Shift',
        startTime: '08:00:00',
        endTime: '16:00:00',
      }),
    ]);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/hr/shifts?');
    expect(String(fetchMock.mock.calls[0][0])).toContain('outletId=101');
    expect(String(fetchMock.mock.calls[0][0])).toContain('sortBy=startTime');
    expect(String(fetchMock.mock.calls[0][0])).toContain('sortDir=asc');
    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=200');
  });

  it('unwraps paged work shift payloads into a plain item list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          {
            id: 9001,
            shiftId: 5100,
            userId: 3011,
            outletId: 101,
            workDate: '2026-04-10',
            scheduleStatus: 'scheduled',
            attendanceStatus: 'pending',
            approvalStatus: 'pending',
          },
        ],
        limit: 20,
        offset: 0,
        total: 1,
        hasMore: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rows = await hrApi.workShifts('token-1', {
      outletId: '101',
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        id: '9001',
        shiftId: '5100',
        userId: '3011',
        outletId: '101',
        workDate: '2026-04-10',
      }),
    ]);
  });

  it('keeps snowflake ids exact when creating work shifts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 9100,
        shiftId: 3477607321800556549,
        userId: 3477607856247160832,
        outletId: 101,
        workDate: '2026-04-10',
        scheduleStatus: 'scheduled',
        attendanceStatus: 'pending',
        approvalStatus: 'pending',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await hrApi.createWorkShift('token-1', {
      shiftId: '3477607321800556549',
      userId: '3477607856247160832',
      workDate: '2026-04-10',
      note: 'Schedule test',
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body || '{}'));
    expect(body).toMatchObject({
      shiftId: '3477607321800556549',
      userId: '3477607856247160832',
      workDate: '2026-04-10',
      note: 'Schedule test',
    });
    expect(typeof body.shiftId).toBe('string');
    expect(typeof body.userId).toBe('string');
  });
});
