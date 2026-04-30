import type { ExpenseSummaryRow } from '@/api/fern-api';

export interface ExpenseSummaryTotals {
  manual: number;
  manualCount: number;
  invoice: number;
  invoiceCount: number;
  payroll: number;
  payrollCount: number;
  system: number;
  systemCount: number;
  total: number;
  totalCount: number;
}

export function buildExpenseSummaryTotals(rows: ExpenseSummaryRow[]): ExpenseSummaryTotals {
  const totals: ExpenseSummaryTotals = {
    manual: 0,
    manualCount: 0,
    invoice: 0,
    invoiceCount: 0,
    payroll: 0,
    payrollCount: 0,
    system: 0,
    systemCount: 0,
    total: 0,
    totalCount: 0,
  };

  for (const row of rows) {
    const sourceType = String(row.sourceType || '').toLowerCase();
    const amount = Number(row.amount || 0);
    const count = Number(row.recordCount || 0);
    if (sourceType === 'payroll') {
      totals.payroll += amount;
      totals.payrollCount += count;
    } else if (sourceType.includes('invoice') || sourceType === 'inventory_purchase') {
      totals.invoice += amount;
      totals.invoiceCount += count;
    } else if (
      sourceType === 'operating_expense'
      || sourceType === 'operating'
      || sourceType === 'other'
      || sourceType === 'other_expense'
    ) {
      totals.manual += amount;
      totals.manualCount += count;
    } else {
      totals.system += amount;
      totals.systemCount += count;
    }
    totals.total += amount;
    totals.totalCount += count;
  }

  return totals;
}
