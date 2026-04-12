import type { PayrollTimesheetView } from '@/api/fern-api';

export type OvertimeFocus = 'all' | 'overtime' | 'late' | 'absent' | 'mixed';
export type OvertimeSortKey =
  | 'exceptionScore'
  | 'payrollPeriodEndDate'
  | 'overtimeHours'
  | 'lateCount'
  | 'absentDays';

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function compareNumbers(left: number, right: number, direction: 'asc' | 'desc') {
  return direction === 'asc' ? left - right : right - left;
}

function compareStrings(left: string, right: string, direction: 'asc' | 'desc') {
  return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
}

function issueCount(row: PayrollTimesheetView) {
  return [
    toNumber(row.overtimeHours) > 0,
    toNumber(row.lateCount) > 0,
    toNumber(row.absentDays) > 0,
  ].filter(Boolean).length;
}

export interface OvertimeExceptionStats {
  rowCount: number;
  affectedEmployeeCount: number;
  overtimeHours: number;
  lateCount: number;
  absentDays: number;
  overtimeRowCount: number;
  lateRowCount: number;
  absentRowCount: number;
  mixedRowCount: number;
}

export function hasTimesheetException(row: PayrollTimesheetView) {
  return toNumber(row.overtimeHours) > 0 || toNumber(row.lateCount) > 0 || toNumber(row.absentDays) > 0;
}

export function matchesOvertimeFocus(row: PayrollTimesheetView, focus: OvertimeFocus) {
  const overtime = toNumber(row.overtimeHours) > 0;
  const late = toNumber(row.lateCount) > 0;
  const absent = toNumber(row.absentDays) > 0;
  switch (focus) {
    case 'overtime':
      return overtime;
    case 'late':
      return late;
    case 'absent':
      return absent;
    case 'mixed':
      return [overtime, late, absent].filter(Boolean).length > 1;
    case 'all':
    default:
      return overtime || late || absent;
  }
}

export function buildOvertimeExceptionStats(rows: PayrollTimesheetView[]): OvertimeExceptionStats {
  return {
    rowCount: rows.length,
    affectedEmployeeCount: new Set(rows.map((row) => String(row.userId || '')).filter(Boolean)).size,
    overtimeHours: rows.reduce((sum, row) => sum + toNumber(row.overtimeHours), 0),
    lateCount: rows.reduce((sum, row) => sum + toNumber(row.lateCount), 0),
    absentDays: rows.reduce((sum, row) => sum + toNumber(row.absentDays), 0),
    overtimeRowCount: rows.filter((row) => toNumber(row.overtimeHours) > 0).length,
    lateRowCount: rows.filter((row) => toNumber(row.lateCount) > 0).length,
    absentRowCount: rows.filter((row) => toNumber(row.absentDays) > 0).length,
    mixedRowCount: rows.filter((row) => issueCount(row) > 1).length,
  };
}

export function compareOvertimeRows(
  left: PayrollTimesheetView,
  right: PayrollTimesheetView,
  sortBy: OvertimeSortKey,
  sortDir: 'asc' | 'desc',
) {
  switch (sortBy) {
    case 'overtimeHours':
      return compareNumbers(toNumber(left.overtimeHours), toNumber(right.overtimeHours), sortDir)
        || compareStrings(String(left.payrollPeriodEndDate || ''), String(right.payrollPeriodEndDate || ''), 'desc')
        || compareStrings(String(left.id || ''), String(right.id || ''), 'desc');
    case 'lateCount':
      return compareNumbers(toNumber(left.lateCount), toNumber(right.lateCount), sortDir)
        || compareNumbers(toNumber(left.absentDays), toNumber(right.absentDays), 'desc')
        || compareStrings(String(left.payrollPeriodEndDate || ''), String(right.payrollPeriodEndDate || ''), 'desc');
    case 'absentDays':
      return compareNumbers(toNumber(left.absentDays), toNumber(right.absentDays), sortDir)
        || compareNumbers(toNumber(left.lateCount), toNumber(right.lateCount), 'desc')
        || compareStrings(String(left.payrollPeriodEndDate || ''), String(right.payrollPeriodEndDate || ''), 'desc');
    case 'payrollPeriodEndDate':
      return compareStrings(String(left.payrollPeriodEndDate || ''), String(right.payrollPeriodEndDate || ''), sortDir)
        || compareStrings(String(left.id || ''), String(right.id || ''), 'desc');
    case 'exceptionScore':
    default:
      return compareNumbers(issueCount(left), issueCount(right), sortDir)
        || compareNumbers(toNumber(left.absentDays), toNumber(right.absentDays), sortDir)
        || compareNumbers(toNumber(left.lateCount), toNumber(right.lateCount), sortDir)
        || compareNumbers(toNumber(left.overtimeHours), toNumber(right.overtimeHours), sortDir)
        || compareStrings(String(left.payrollPeriodEndDate || ''), String(right.payrollPeriodEndDate || ''), 'desc')
        || compareStrings(String(left.id || ''), String(right.id || ''), 'desc');
  }
}
