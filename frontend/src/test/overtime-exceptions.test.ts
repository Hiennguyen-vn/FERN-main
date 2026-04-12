import { describe, expect, it } from 'vitest';
import {
  buildOvertimeExceptionStats,
  compareOvertimeRows,
  hasTimesheetException,
  matchesOvertimeFocus,
} from '@/components/workforce/overtime-exceptions';

describe('overtime exception helpers', () => {
  const rows = [
    {
      id: 'ts-1',
      userId: 'u-1',
      payrollPeriodEndDate: '2026-03-31',
      overtimeHours: 2,
      lateCount: 0,
      absentDays: 0,
    },
    {
      id: 'ts-2',
      userId: 'u-2',
      payrollPeriodEndDate: '2026-03-31',
      overtimeHours: 0,
      lateCount: 3,
      absentDays: 1,
    },
    {
      id: 'ts-3',
      userId: 'u-2',
      payrollPeriodEndDate: '2026-02-28',
      overtimeHours: 0,
      lateCount: 0,
      absentDays: 0,
    },
  ];

  it('detects exception rows and focus buckets', () => {
    expect(hasTimesheetException(rows[0])).toBe(true);
    expect(hasTimesheetException(rows[2])).toBe(false);
    expect(matchesOvertimeFocus(rows[0], 'overtime')).toBe(true);
    expect(matchesOvertimeFocus(rows[1], 'late')).toBe(true);
    expect(matchesOvertimeFocus(rows[1], 'absent')).toBe(true);
    expect(matchesOvertimeFocus(rows[1], 'mixed')).toBe(true);
    expect(matchesOvertimeFocus(rows[0], 'mixed')).toBe(false);
  });

  it('summarizes exception totals from visible rows', () => {
    const stats = buildOvertimeExceptionStats(rows.filter(hasTimesheetException));

    expect(stats).toEqual({
      rowCount: 2,
      affectedEmployeeCount: 2,
      overtimeHours: 2,
      lateCount: 3,
      absentDays: 1,
      overtimeRowCount: 1,
      lateRowCount: 1,
      absentRowCount: 1,
      mixedRowCount: 1,
    });
  });

  it('sorts impact-first rows above single-signal rows', () => {
    const sorted = rows
      .filter(hasTimesheetException)
      .slice()
      .sort((left, right) => compareOvertimeRows(left, right, 'exceptionScore', 'desc'));

    expect(sorted.map((row) => row.id)).toEqual(['ts-2', 'ts-1']);
  });
});
