export type FinanceTab = 'expenses' | 'review';

export const FINANCE_TAB_ITEMS = [
  { key: 'expenses', label: 'Expense Ledger' },
  { key: 'review', label: 'Payroll Review' },
] as const satisfies ReadonlyArray<{ key: FinanceTab; label: string }>;

export const FINANCE_EXPENSE_FILTER_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'inventory_purchase', label: 'Inventory purchase' },
  { value: 'operating_expense', label: 'Operating expense' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'other', label: 'Other' },
] as const;

export const FINANCE_CREATE_EXPENSE_OPTIONS = [
  { value: 'operating_expense', label: 'Operating expense' },
  { value: 'other', label: 'Other expense' },
] as const;
