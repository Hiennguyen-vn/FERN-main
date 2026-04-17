export type HrTab = 'attendance' | 'employees' | 'contracts' | 'payroll' | 'prep';

export const HR_TAB_ITEMS = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'employees', label: 'Employees' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'prep', label: 'Payroll Prep' },
] as const satisfies ReadonlyArray<{ key: HrTab; label: string }>;
