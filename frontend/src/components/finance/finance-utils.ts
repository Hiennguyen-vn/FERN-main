/**
 * finance-utils.ts
 *
 * Shared helpers for the Finance module.
 * All workspaces import from here — no local redefinitions.
 */

// ---------------------------------------------------------------------------
// Number helpers
// ---------------------------------------------------------------------------

export function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * formatMoney — compact currency formatting (no decimals for large values).
 * Use for KPI cards and table cells.
 */
export function formatMoney(value: unknown, currency = 'VND'): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toNum(value));
}

/**
 * formatMoneyExact — two-decimal formatting for ledger rows / payroll detail.
 */
export function formatMoneyExact(value: unknown, currency = 'VND'): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNum(value));
}

/**
 * formatPct — format a ratio (0–100 number) as "42.3%".
 * Pass null to get "—".
 */
export function formatPct(value: number | null, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

/**
 * formatDelta — "+12.3%" / "-4.1%" / "New baseline"
 */
export function formatDelta(value: number | null, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return 'New baseline';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(decimals)}%`;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function formatDateShort(value?: string | null): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : `${value}T00:00:00`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatMonthYear(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(d);
}

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

/**
 * Flattens a roles-by-outlet map into a single set of canonical role codes.
 *
 * For session-derived roles, call `sessionRolesSet` / `effectiveRolesByOutletRecord`
 * from `@/auth/authorization` first so an empty `canonicalRolesByOutlet` object
 * still falls back to `rolesByOutlet` (same as sidebar matrix checks).
 */
export function resolveCanonicalRoles(
  canonicalRolesByOutlet: Record<string, string[]> | undefined,
): Set<string> {
  const result = new Set<string>();
  for (const list of Object.values(canonicalRolesByOutlet ?? {})) {
    for (const r of list ?? []) {
      if (r) result.add(r);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Source label
// ---------------------------------------------------------------------------

export interface SourceBadge {
  label: string;
  className: string;
  /** Whether a user can edit this row */
  editable: boolean;
}

export function getExpenseSourceBadge(
  sourceType?: string | null,
  subtype?: string | null,
): SourceBadge {
  const raw = String(subtype || sourceType || '').toLowerCase();
  if (raw === 'payroll') {
    return { label: 'Payroll', className: 'bg-purple-100 text-purple-700 border-purple-200', editable: false };
  }
  if (raw.includes('invoice') || raw === 'inventory_purchase') {
    return { label: 'Invoice', className: 'bg-orange-100 text-orange-700 border-orange-200', editable: false };
  }
  if (
    raw === 'operating_expense' ||
    raw === 'operating' ||
    raw === 'other' ||
    raw === 'other_expense'
  ) {
    return { label: 'Manual', className: 'bg-blue-100 text-blue-700 border-blue-200', editable: true };
  }
  return { label: 'System', className: 'bg-muted text-muted-foreground border-border', editable: false };
}

// ---------------------------------------------------------------------------
// Variance badge helpers
// ---------------------------------------------------------------------------

export type VarianceLevel = 'ok' | 'watch' | 'risk' | 'none';

export function laborVarianceLevel(laborPct: number | null): VarianceLevel {
  if (laborPct == null) return 'none';
  if (laborPct > 40) return 'risk';
  if (laborPct > 35) return 'watch';
  return 'ok';
}

export function opexVarianceLevel(opexPct: number | null): VarianceLevel {
  if (opexPct == null) return 'none';
  if (opexPct > 30) return 'risk';
  if (opexPct > 25) return 'watch';
  return 'ok';
}

export function primeCostVarianceLevel(
  primeCostPct: number | null,
  threshold = 65,
): VarianceLevel {
  if (primeCostPct == null) return 'none';
  if (primeCostPct > threshold + 5) return 'risk';
  if (primeCostPct > threshold) return 'watch';
  return 'ok';
}

export function varianceBadgeClass(level: VarianceLevel): string {
  switch (level) {
    case 'risk':  return 'border-red-200 bg-red-50 text-red-700';
    case 'watch': return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'ok':    return 'border-green-200 bg-green-50 text-green-700';
    default:      return 'border-border bg-muted text-muted-foreground';
  }
}

export function varianceIcon(level: VarianceLevel): string {
  switch (level) {
    case 'risk':  return '✗';
    case 'watch': return '⚠';
    case 'ok':    return '✓';
    default:      return '—';
  }
}
