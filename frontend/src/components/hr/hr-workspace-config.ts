export type HrTab = 'attendance' | 'contracts' | 'prep';

export const HR_TAB_ITEMS = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'prep', label: 'Payroll Prep' },
] as const satisfies ReadonlyArray<{ key: HrTab; label: string }>;
