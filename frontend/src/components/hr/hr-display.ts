import type {
  AuthUserListItem,
  ScopeOutlet,
  ShiftView,
} from '@/api/fern-api';

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

export function shortHrRef(value: string | number | null | undefined) {
  const normalized = normalizeValue(value);
  if (!normalized) return '—';
  return normalized.length > 8 ? `#${normalized.slice(-8)}` : `#${normalized}`;
}

export function getHrUserDisplay(
  usersById: Map<string, AuthUserListItem>,
  userId?: string | number | null,
) {
  const key = normalizeValue(userId);
  if (!key) {
    return { primary: '—', secondary: undefined as string | undefined };
  }

  const user = usersById.get(key);
  if (!user) {
    return { primary: `User ${key}`, secondary: undefined as string | undefined };
  }

  return {
    primary: user.fullName || user.username,
    secondary: user.employeeCode || user.username || key,
  };
}

export function getHrOutletDisplay(
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

function formatTimeValue(value: string | null | undefined) {
  const normalized = normalizeValue(value);
  if (!normalized) return '';
  return normalized.slice(0, 5);
}

export function getHrShiftDisplay(
  shiftsById: Map<string, ShiftView>,
  shiftId?: string | number | null,
) {
  const key = normalizeValue(shiftId);
  if (!key) {
    return { primary: '—', secondary: undefined as string | undefined };
  }

  const shift = shiftsById.get(key);
  if (!shift) {
    return { primary: `Shift ${key}`, secondary: undefined as string | undefined };
  }

  const code = normalizeValue(shift.code);
  const name = normalizeValue(shift.name);
  const startTime = formatTimeValue(shift.startTime);
  const endTime = formatTimeValue(shift.endTime);
  return {
    primary: [code, name].filter(Boolean).join(' · ') || `Shift ${key}`,
    secondary: startTime && endTime ? `${startTime} - ${endTime}` : undefined,
  };
}

export function formatHrEnumLabel(value: string | null | undefined) {
  const normalized = normalizeValue(value).toLowerCase();
  if (!normalized) return '—';

  switch (normalized) {
    case 'full_time':
      return 'Full time';
    case 'part_time':
      return 'Part time';
    case 'operating_expense':
      return 'Operating';
    default:
      return titleCaseWords(normalized);
  }
}

export function attendanceBadgeClass(value: string | null | undefined) {
  switch (normalizeValue(value).toLowerCase()) {
    case 'present':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'late':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'absent':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'leave':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'pending':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function scheduleBadgeClass(value: string | null | undefined) {
  switch (normalizeValue(value).toLowerCase()) {
    case 'scheduled':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'confirmed':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'cancelled':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function approvalBadgeClass(value: string | null | undefined) {
  switch (normalizeValue(value).toLowerCase()) {
    case 'approved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'rejected':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'pending':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function payrollBadgeClass(value: string | null | undefined) {
  switch (normalizeValue(value).toLowerCase()) {
    case 'approved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'paid':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'rejected':
    case 'cancelled':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'draft':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function contractBadgeClass(value: string | null | undefined) {
  switch (normalizeValue(value).toLowerCase()) {
    case 'active':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'draft':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'expired':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'terminated':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}
