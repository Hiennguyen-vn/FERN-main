import { describe, expect, it } from 'vitest';
import {
  FINANCE_EXPENSE_FILTER_OPTIONS,
  FINANCE_TAB_ITEMS,
} from '@/components/finance/finance-workspace-config';
import { HR_TAB_ITEMS } from '@/components/hr/hr-workspace-config';

describe('workspace configuration', () => {
  it('keeps Finance limited to ledger and payroll review', () => {
    expect(FINANCE_TAB_ITEMS.map((tab) => tab.key)).toEqual(['expenses', 'review']);
    expect(FINANCE_TAB_ITEMS.map((tab) => tab.label)).toEqual(['Expense Ledger', 'Payroll Review']);
  });

  it('uses backend truth for finance expense filter enums', () => {
    expect(FINANCE_EXPENSE_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      'all',
      'inventory_purchase',
      'operating_expense',
      'payroll',
      'other',
    ]);
  });

  it('keeps HR scoped to attendance, contracts, and payroll prep', () => {
    expect(HR_TAB_ITEMS.map((tab) => tab.key)).toEqual(['attendance', 'contracts', 'prep']);
    expect(HR_TAB_ITEMS.map((tab) => tab.label)).toEqual(['Attendance', 'Contracts', 'Payroll Prep']);
  });
});
