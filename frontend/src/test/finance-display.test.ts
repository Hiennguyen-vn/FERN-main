import { describe, expect, it } from 'vitest';
import {
  formatFinanceExpenseTypeLabel,
  getFinanceOutletDisplay,
} from '@/components/finance/finance-display';

describe('finance display helpers', () => {
  it('renders outlet code and name before the raw outlet id', () => {
    const outletsById = new Map([
      ['2002', {
        id: '2002',
        regionId: '1001',
        code: 'SIM-SMALL-OUT-0002',
        name: 'Outlet VN-HCM-2',
        status: 'active',
      }],
    ]);

    expect(getFinanceOutletDisplay(outletsById, '2002')).toEqual({
      primary: 'SIM-SMALL-OUT-0002 · Outlet VN-HCM-2',
      secondary: '2002',
    });
  });

  it('falls back to a readable outlet label when hierarchy data is missing', () => {
    expect(getFinanceOutletDisplay(new Map(), '3477607334215696384')).toEqual({
      primary: 'Outlet 3477607334215696384',
      secondary: undefined,
    });
  });

  it('humanizes finance expense types from backend enums', () => {
    expect(formatFinanceExpenseTypeLabel('inventory_purchase')).toBe('Inventory purchase');
    expect(formatFinanceExpenseTypeLabel('operating_expense')).toBe('Operating');
    expect(formatFinanceExpenseTypeLabel('other')).toBe('Other');
    expect(formatFinanceExpenseTypeLabel('base', 'payroll')).toBe('Payroll');
  });
});
