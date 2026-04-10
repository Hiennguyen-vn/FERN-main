import { describe, expect, it } from 'vitest';
import {
  formatHrEnumLabel,
  getHrOutletDisplay,
  getHrShiftDisplay,
  getHrUserDisplay,
  shortHrRef,
} from '@/components/hr/hr-display';

describe('hr display helpers', () => {
  it('formats long ids into short HR references', () => {
    expect(shortHrRef('3477607958382657500')).toBe('#82657500');
  });

  it('renders readable user, outlet, and shift displays from support maps', () => {
    const usersById = new Map([
      ['3011', {
        id: '3011',
        username: 'alice',
        fullName: 'Alice Nguyen',
        employeeCode: 'EMP-3011',
      }],
    ]);
    const outletsById = new Map([
      ['2000', {
        id: '2000',
        regionId: '1000',
        code: 'SIM-SMALL-OUT-0001',
        name: 'Outlet 1 - VN-HCM',
        status: 'active',
      }],
    ]);
    const shiftsById = new Map([
      ['5100', {
        id: '5100',
        code: 'AM',
        name: 'Morning Shift',
        startTime: '08:00:00',
        endTime: '16:00:00',
      }],
    ]);

    expect(getHrUserDisplay(usersById, '3011')).toEqual({
      primary: 'Alice Nguyen',
      secondary: 'EMP-3011',
    });
    expect(getHrOutletDisplay(outletsById, '2000')).toEqual({
      primary: 'SIM-SMALL-OUT-0001 · Outlet 1 - VN-HCM',
      secondary: '2000',
    });
    expect(getHrShiftDisplay(shiftsById, '5100')).toEqual({
      primary: 'AM · Morning Shift',
      secondary: '08:00 - 16:00',
    });
  });

  it('humanizes backend hr enums for the UI', () => {
    expect(formatHrEnumLabel('part_time')).toBe('Part time');
    expect(formatHrEnumLabel('pending')).toBe('Pending');
    expect(formatHrEnumLabel('approved')).toBe('Approved');
    expect(formatHrEnumLabel('terminated')).toBe('Terminated');
  });
});
