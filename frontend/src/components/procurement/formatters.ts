import { normalizeCurrencyCode } from '@/lib/org-currency';

const ZERO_DECIMAL_CURRENCIES = new Set(['VND', 'JPY', 'KRW']);

function normalizeStatus(status: string | null | undefined) {
  return String(status ?? '').trim().toLowerCase();
}

export function formatProcurementAmount(value: number | null | undefined, currencyCode?: string | null) {
  const amount = Number(value ?? 0);
  const normalizedCurrencyCode = normalizeCurrencyCode(currencyCode);
  const fractionDigits = ZERO_DECIMAL_CURRENCIES.has(normalizedCurrencyCode) ? 0 : 2;

  try {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return amount.toFixed(fractionDigits);
  }
}

export function formatProcurementStatusLabel(status: string | null | undefined) {
  const normalized = normalizeStatus(status);
  if (!normalized) return 'Unknown';

  return normalized
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function procurementStatusTone(status: string | null | undefined) {
  const normalized = normalizeStatus(status);

  if (['posted', 'completed', 'paid', 'processed'].includes(normalized)) {
    return 'border-emerald-200 bg-emerald-500/10 text-emerald-700';
  }

  if (['approved', 'ordered', 'received', 'matched', 'active'].includes(normalized)) {
    return 'border-blue-200 bg-blue-500/10 text-blue-700';
  }

  if (['draft', 'submitted', 'pending', 'pending_review'].includes(normalized)) {
    return 'border-amber-200 bg-amber-500/10 text-amber-700';
  }

  if (['partially_received', 'partially_paid'].includes(normalized)) {
    return 'border-violet-200 bg-violet-500/10 text-violet-700';
  }

  if (normalized === 'closed') {
    return 'border-slate-200 bg-slate-500/10 text-slate-700';
  }

  if (['cancelled', 'reversed', 'inactive', 'rejected', 'disputed'].includes(normalized)) {
    return 'border-rose-200 bg-rose-500/10 text-rose-700';
  }

  return 'border-border bg-muted text-muted-foreground';
}
