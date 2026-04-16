export type FinanceTab =
  | 'overview'
  | 'revenue'
  | 'labor'
  | 'expenses'
  | 'prime-cost'
  | 'close';

export const FINANCE_TAB_ITEMS = [
  { key: 'overview' as const, label: 'Overview', icon: 'LayoutDashboard' },
  { key: 'revenue' as const, label: 'Revenue', icon: 'TrendingUp' },
  { key: 'labor' as const, label: 'Labor & Payroll', icon: 'Users' },
  { key: 'expenses' as const, label: 'Operating Expenses', icon: 'Receipt' },
  { key: 'prime-cost' as const, label: 'Prime Cost', icon: 'PieChart' },
  { key: 'close' as const, label: 'Period Close', icon: 'Lock' },
] as const satisfies ReadonlyArray<{ key: FinanceTab; label: string; icon: string }>;

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

export type FinanceCreateExpenseSource =
  (typeof FINANCE_CREATE_EXPENSE_OPTIONS)[number]['value'];
