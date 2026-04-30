import { describe, expect, it } from 'vitest';
import { buildExpenseSummaryTotals } from '@/components/finance/finance-expense-summary';

describe('finance expense summary totals', () => {
  it('aggregates all matching rows by source instead of a paged ledger slice', () => {
    const totals = buildExpenseSummaryTotals([
      { sourceType: 'operating_expense', recordCount: 20, amount: 2000, currencyCode: 'VND' },
      { sourceType: 'other', recordCount: 2, amount: 300, currencyCode: 'VND' },
      { sourceType: 'inventory_purchase', recordCount: 5, amount: 700, currencyCode: 'VND' },
      { sourceType: 'payroll', recordCount: 1, amount: 1000, currencyCode: 'VND' },
      { sourceType: 'system_adjustment', recordCount: 1, amount: 50, currencyCode: 'VND' },
    ]);

    expect(totals.manual).toBe(2300);
    expect(totals.manualCount).toBe(22);
    expect(totals.invoice).toBe(700);
    expect(totals.payroll).toBe(1000);
    expect(totals.system).toBe(50);
    expect(totals.total).toBe(4050);
    expect(totals.totalCount).toBe(29);
  });
});
