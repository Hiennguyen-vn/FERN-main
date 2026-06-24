import { describe, expect, it } from 'vitest';
import { currentLocalMonthRange } from '@/lib/date-format';

describe('date-format helpers', () => {
  it('builds current local month date-only API filters', () => {
    expect(currentLocalMonthRange(new Date(2026, 5, 15))).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      label: 'June 2026',
    });
  });
});
