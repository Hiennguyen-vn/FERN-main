import type { ScopeOutlet } from '@/api/org-api';

function normalizeValue(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

function titleCaseWords(value: string) {
  return value
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getFinanceOutletDisplay(
  outletsById: Map<string, ScopeOutlet>,
  outletId?: string | number | null,
) {
  const key = normalizeValue(outletId);
  if (!key) {
    return { primary: '—', secondary: undefined as string | undefined };
  }

  const outlet = outletsById.get(key);
  if (!outlet) {
    return { primary: `Outlet ${key}`, secondary: undefined as string | undefined };
  }

  return {
    primary: `${outlet.code} · ${outlet.name}`,
    secondary: key,
  };
}

export function formatFinanceExpenseTypeLabel(
  value: string | null | undefined,
  fallbackValue?: string | null | undefined,
) {
  const normalized = normalizeValue(value).toLowerCase();
  const fallback = normalizeValue(fallbackValue).toLowerCase();
  const effective = normalized && normalized !== 'base' ? normalized : fallback;

  switch (effective) {
    case 'inventory_purchase':
      return 'Inventory purchase';
    case 'operating':
    case 'operating_expense':
      return 'Operating';
    case 'other':
    case 'other_expense':
      return 'Other';
    case 'payroll':
      return 'Payroll';
    default:
      return effective ? titleCaseWords(effective) : '—';
  }
}
