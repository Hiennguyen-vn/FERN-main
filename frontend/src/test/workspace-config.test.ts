import { describe, expect, it } from 'vitest';
import {
  FINANCE_EXPENSE_FILTER_OPTIONS,
  FINANCE_TAB_ITEMS,
} from '@/components/finance/finance-workspace-config';
import { HR_TAB_ITEMS } from '@/components/hr/hr-workspace-config';

describe('workspace configuration', () => {
  it('exposes the finance workspaces from the blueprint', () => {
    expect(FINANCE_TAB_ITEMS.map((tab) => tab.key)).toEqual([
      'overview',
      'pl',
      'revenue',
      'labor',
      'expenses',
      'prime-cost',
      'close',
    ]);
    expect(FINANCE_TAB_ITEMS.map((tab) => tab.label)).toEqual([
      'Overview',
      'P&L Summary',
      'Revenue',
      'Labor & Payroll',
      'Operating Expenses',
      'Prime Cost',
      'Period Close',
    ]);
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

  it('keeps HR scoped to attendance, people, contracts, payroll, and prep', () => {
    expect(HR_TAB_ITEMS.map((tab) => tab.key)).toEqual(['attendance', 'employees', 'contracts', 'payroll', 'prep']);
    expect(HR_TAB_ITEMS.map((tab) => tab.label)).toEqual(['Attendance', 'Employees', 'Contracts', 'Payroll', 'Payroll Prep']);
  });
});
