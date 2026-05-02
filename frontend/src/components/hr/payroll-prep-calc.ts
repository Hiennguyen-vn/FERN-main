/**
 * payroll-prep-calc.ts
 *
 * Pure functions extracted from PayrollPrepWorkspace.
 * No React dependencies — unit-testable, zero side-effects.
 */

import type { ContractView, PayrollPeriodView, ScopeRegion } from '@/api/fern-api';
import { formatHrEnumLabel } from '@/components/hr/hr-display';

/* ── Step type ─────────────────────────────────────────────────────── */

export type PrepStep = 1 | 2 | 3 | 4;

/* ── Number / string helpers ───────────────────────────────────────── */

export function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeValue(value: string | number | null | undefined): string {
  return String(value ?? '').trim();
}

/* ── Date formatters ───────────────────────────────────────────────── */

export function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function formatDateRange(s?: string | null, e?: string | null): string {
  if (!s && !e) return '—';
  return `${formatDate(s)} – ${formatDate(e)}`;
}

export function formatMonthYear(value?: string | null): string {
  if (!value) return 'Payroll prep';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'Payroll prep';
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
}

/* ── Currency formatter ────────────────────────────────────────────── */

export function formatCurrency(value: unknown, currency = 'VND'): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

/* ── Working days calculator ───────────────────────────────────────── */

/** Count Mon–Fri business days between start and end (inclusive). */
export function countWorkingDays(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/* ── Period display helpers ────────────────────────────────────────── */

export function getRegionName(regionsById: Map<string, ScopeRegion>, regionId?: string | number | null): string {
  const key = normalizeValue(regionId);
  if (!key) return 'Selected region';
  return regionsById.get(key)?.name || `Region ${key}`;
}

export function buildPeriodHeadline(period: PayrollPeriodView | null, regionName: string): string {
  const name = normalizeValue(period?.name);
  if (name) return name;
  return `${formatMonthYear(period?.startDate || period?.endDate || period?.payDate)} · ${regionName}`;
}

export function isContractEffectiveForPeriod(contract: ContractView, period: PayrollPeriodView | null): boolean {
  if (normalizeValue(contract.status).toLowerCase() !== 'active') {
    return false;
  }

  if (!period?.startDate || !period.endDate) {
    return true;
  }

  const contractStart = normalizeValue(contract.startDate);
  const contractEnd = normalizeValue(contract.endDate);

  if (contractStart && contractStart > period.endDate) {
    return false;
  }
  if (contractEnd && contractEnd < period.startDate) {
    return false;
  }
  return true;
}

export function buildRegionCoverageLabel(selectedRegionCodes: string[], selectedRegionName: string): string {
  if (selectedRegionCodes.length === 0) return selectedRegionName;
  if (selectedRegionCodes.length <= 3) return selectedRegionCodes.join(', ');
  return `${selectedRegionCodes.slice(0, 3).join(', ')} +${selectedRegionCodes.length - 3}`;
}

/* ── Default form builders ─────────────────────────────────────────── */

export interface DefaultPeriodForm {
  regionId: string;
  name: string;
  startDate: string;
  endDate: string;
  payDate: string;
  note: string;
}

export function buildDefaultPeriodForm(regionId = ''): DefaultPeriodForm {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const payDate = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  return {
    regionId,
    name: '',
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
    payDate: formatDateInput(payDate),
    note: '',
  };
}

export interface DefaultTimesheetForm {
  userId: string;
  outletId: string;
  workDays: string;
  workHours: string;
  overtimeHours: string;
  overtimeRate: string;
  lateCount: string;
  absentDays: string;
}

export function buildDefaultTimesheetForm(outletId = ''): DefaultTimesheetForm {
  return {
    userId: '',
    outletId,
    workDays: '',
    workHours: '',
    overtimeHours: '0',
    overtimeRate: '1.5',
    lateCount: '0',
    absentDays: '0',
  };
}

export interface DefaultRunForm {
  payrollTimesheetId: string;
  currencyCode: string;
  baseSalaryAmount: string;
  netSalary: string;
  note: string;
}

export function buildDefaultRunForm(): DefaultRunForm {
  return {
    payrollTimesheetId: '',
    currencyCode: 'VND',
    baseSalaryAmount: '',
    netSalary: '',
    note: '',
  };
}

/* ── Stat calculators ──────────────────────────────────────────────── */

/** Minimal shape of a roster entry needed for stat computation. */
export interface RosterEntryLike {
  userId: string;
  preferredOutletId: string;
  contract: ContractView;
}

export interface RosterOperationalStats {
  outletCount: number;
  regionCount: number;
  estimatedBaseSalary: number;
  currencyCode: string;
  topEmploymentType: string;
}

export function computeRosterOperationalStats(payrollRoster: RosterEntryLike[]): RosterOperationalStats {
  const outletIds = new Set<string>();
  const regionCodes = new Set<string>();
  const employmentTypes = new Map<string, number>();
  let estimatedBaseSalary = 0;

  for (const entry of payrollRoster) {
    const outletId = normalizeValue(entry.preferredOutletId);
    const regionCode = normalizeValue(entry.contract.regionCode);
    const employmentType = formatHrEnumLabel(entry.contract.employmentType);
    if (outletId) outletIds.add(outletId);
    if (regionCode) regionCodes.add(regionCode);
    employmentTypes.set(employmentType, (employmentTypes.get(employmentType) || 0) + 1);
    estimatedBaseSalary += toNumber(entry.contract.baseSalary);
  }

  const topEntry = [...employmentTypes.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    outletCount: outletIds.size,
    regionCount: regionCodes.size,
    estimatedBaseSalary,
    currencyCode: normalizeValue(payrollRoster[0]?.contract.currencyCode) || 'VND',
    topEmploymentType: topEntry ? `${topEntry[0]} (${topEntry[1]})` : 'No contracts',
  };
}

export interface RosterImportStats {
  importedRosterCount: number;
  pendingRosterCount: number;
  completionPercent: number;
}

export function computeRosterImportStats(
  rosterCount: number,
  importedUserIds: Set<string>,
  payrollRoster: RosterEntryLike[],
): RosterImportStats {
  const importedRosterCount = payrollRoster.filter((e) => importedUserIds.has(e.userId)).length;
  return {
    importedRosterCount,
    pendingRosterCount: Math.max(rosterCount - importedRosterCount, 0),
    completionPercent: rosterCount > 0 ? Math.round((importedRosterCount / rosterCount) * 100) : 0,
  };
}

export interface RunCoverageStats {
  generatedRunCount: number;
  pendingRunCount: number;
  completionPercent: number;
}

export function computeRunCoverageStats(timesheetCount: number, generatedRunCount: number): RunCoverageStats {
  return {
    generatedRunCount,
    pendingRunCount: Math.max(timesheetCount - generatedRunCount, 0),
    completionPercent: timesheetCount > 0 ? Math.round((generatedRunCount / timesheetCount) * 100) : 0,
  };
}

export interface PayrollReadiness {
  label: string;
  description: string;
  tone: 'amber' | 'blue' | 'green';
  actionLabel: string;
  targetStep: PrepStep;
}

export function computePayrollReadiness(
  rosterCount: number,
  pendingRosterCount: number,
  pendingRunCount: number,
): PayrollReadiness {
  if (rosterCount === 0) {
    return {
      label: 'Roster setup needed',
      description: 'No active contracts match this payroll scope yet.',
      tone: 'amber',
      actionLabel: 'Review contracts',
      targetStep: 2,
    };
  }
  if (pendingRosterCount > 0) {
    return {
      label: 'Attendance import needed',
      description: `${pendingRosterCount} employee${pendingRosterCount === 1 ? '' : 's'} still need timesheets.`,
      tone: 'amber',
      actionLabel: 'Import attendance',
      targetStep: 2,
    };
  }
  if (pendingRunCount > 0) {
    return {
      label: 'Ready for draft payroll',
      description: `${pendingRunCount} timesheet${pendingRunCount === 1 ? '' : 's'} can be converted to draft runs.`,
      tone: 'blue',
      actionLabel: 'Generate runs',
      targetStep: 4,
    };
  }
  return {
    label: 'Ready for finance review',
    description: 'Timesheets and payroll runs are prepared for this window.',
    tone: 'green',
    actionLabel: 'Review runs',
    targetStep: 4,
  };
}

/* ── Timesheet aggregate helpers ───────────────────────────────────── */

export interface TimesheetAggregates {
  totalWorkHours: number;
  totalOvertimeHours: number;
  totalWorkDays: number;
}

export function computeTimesheetAggregates(timesheets: Array<{
  workHours?: number | string | null;
  overtimeHours?: number | string | null;
  workDays?: number | string | null;
}>): TimesheetAggregates {
  return {
    totalWorkHours: timesheets.reduce((s, ts) => s + toNumber(ts.workHours), 0),
    totalOvertimeHours: timesheets.reduce((s, ts) => s + toNumber(ts.overtimeHours), 0),
    totalWorkDays: timesheets.reduce((s, ts) => s + toNumber(ts.workDays), 0),
  };
}

export function computeNetRunTotal(runs: Array<{ netSalary?: number | string | null; currencyCode?: string | null }>): {
  total: number;
  currencyCode: string;
} {
  return {
    total: runs.reduce((s, r) => s + toNumber(r.netSalary), 0),
    currencyCode: normalizeValue(runs[0]?.currencyCode) || 'VND',
  };
}
