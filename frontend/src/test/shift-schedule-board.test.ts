import { describe, expect, it } from 'vitest';
import { buildShiftScheduleLanes } from '@/components/workforce/shift-schedule-board';

describe('shift schedule board helpers', () => {
  it('orders lanes by shift time and groups assignments under each shift', () => {
    const lanes = buildShiftScheduleLanes(
      [
        { id: 's2', code: 'PM', name: 'Afternoon', startTime: '14:00:00', endTime: '18:00:00' },
        { id: 's1', code: 'AM', name: 'Morning', startTime: '08:00:00', endTime: '12:00:00' },
      ],
      [
        { id: 'w2', shiftId: 's2', userId: 'u2', workDate: '2026-04-10', attendanceStatus: 'late', approvalStatus: 'approved' },
        { id: 'w1', shiftId: 's1', userId: 'u1', workDate: '2026-04-10', attendanceStatus: 'present', approvalStatus: 'pending' },
      ],
    );

    expect(lanes.map((lane) => lane.shiftId)).toEqual(['s1', 's2']);
    expect(lanes[0].summary).toEqual({
      assignedCount: 1,
      pendingReviewCount: 1,
      attendancePendingCount: 0,
      presentCount: 1,
      lateCount: 0,
      absentCount: 0,
      leaveCount: 0,
    });
    expect(lanes[1].summary.presentCount).toBe(0);
    expect(lanes[1].summary.lateCount).toBe(1);
  });

  it('keeps unresolved assignments visible as fallback lanes', () => {
    const lanes = buildShiftScheduleLanes(
      [
        { id: 's1', code: 'AM', name: 'Morning', startTime: '08:00:00', endTime: '12:00:00' },
      ],
      [
        { id: 'w1', shiftId: 'missing-shift', userId: 'u1', workDate: '2026-04-10', attendanceStatus: 'pending', approvalStatus: 'pending' },
      ],
    );

    expect(lanes).toHaveLength(2);
    expect(lanes[1]).toMatchObject({
      shiftId: 'missing-shift',
      isResolved: false,
      summary: {
        assignedCount: 1,
        pendingReviewCount: 1,
        attendancePendingCount: 1,
      },
    });
  });
});
