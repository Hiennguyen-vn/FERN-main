function normalizeStatus(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

export const STOCK_COUNT_STATUSES = [
  'draft',
  'counting',
  'submitted',
  'approved',
  'posted',
  'cancelled',
] as const;

export function formatStockCountStatus(value: string | null | undefined) {
  const normalized = normalizeStatus(value);
  if (!normalized) return 'Unknown';

  return normalized
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function stockCountStatusBadgeClass(value: string | null | undefined) {
  switch (normalizeStatus(value)) {
    case 'posted':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'approved':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'submitted':
    case 'counting':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'draft':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'cancelled':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function canPostStockCountSession(status: string | null | undefined) {
  const normalized = normalizeStatus(status);
  return normalized !== 'posted' && normalized !== 'cancelled';
}
