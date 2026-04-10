import { describe, expect, it } from 'vitest';
import { buildWorkShiftAssignmentPayloads } from '@/components/workforce/work-shift-assignment';

describe('work shift assignment helpers', () => {
  it('builds one payload per unique selected employee', () => {
    expect(buildWorkShiftAssignmentPayloads({
      userIds: ['3011', '3012', '3011'],
      shiftId: '5100',
      workDate: '2026-04-10',
      note: ' Morning setup ',
    })).toEqual([
      {
        userId: '3011',
        shiftId: '5100',
        workDate: '2026-04-10',
        note: 'Morning setup',
      },
      {
        userId: '3012',
        shiftId: '5100',
        workDate: '2026-04-10',
        note: 'Morning setup',
      },
    ]);
  });

  it('requires shift, date, and at least one employee', () => {
    expect(() => buildWorkShiftAssignmentPayloads({
      userIds: [],
      shiftId: '',
      workDate: '',
      note: '',
    })).toThrowError('Select a shift before assigning');

    expect(() => buildWorkShiftAssignmentPayloads({
      userIds: ['3011'],
      shiftId: '5100',
      workDate: '',
      note: '',
    })).toThrowError('Select a work date before assigning');

    expect(() => buildWorkShiftAssignmentPayloads({
      userIds: [],
      shiftId: '5100',
      workDate: '2026-04-10',
      note: '',
    })).toThrowError('Select at least one employee before assigning');
  });
});
