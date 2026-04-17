import { apiRequest, type PagedResponse } from '@/api/client';
import { decodePaged } from '@/api/decoders';
import {
  asDateOnly,
  asId,
  asIsoDateTime,
  asNullableNumber,
  asNullableString,
  asNumber,
  asRecord,
  asString,
} from '@/api/records';

export interface PayrollPeriodView {
  id: string;
  regionId?: string | null;
  name?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  payDate?: string | null;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PayrollTimesheetView {
  id: string;
  payrollPeriodId?: string | null;
  payrollPeriodName?: string | null;
  payrollPeriodStartDate?: string | null;
  payrollPeriodEndDate?: string | null;
  outletId?: string | null;
  userId?: string | null;
  status?: string | null;
  workDays?: number | null;
  workHours?: number | null;
  overtimeHours?: number | null;
  overtimeRate?: number | null;
  lateCount?: number | null;
  absentDays?: number | null;
  approvedByUserId?: string | null;
  totalHours?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PayrollRunView {
  id: string;
  payrollTimesheetId?: string | null;
  payrollPeriodId?: string | null;
  payrollPeriodName?: string | null;
  outletId?: string | null;
  userId?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  baseSalaryAmount?: number | null;
  netSalary?: number | null;
  currencyCode?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  paymentRef?: string | null;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PayrollPeriodsQuery {
  regionId?: string;
  startDate?: string;
  endDate?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PayrollTimesheetsQuery {
  payrollPeriodId?: string;
  userId?: string;
  outletId?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PayrollRunsQuery {
  payrollPeriodId?: string;
  userId?: string;
  outletId?: string;
  status?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CreatePayrollPeriodPayload {
  regionId: string;
  name: string;
  startDate: string;
  endDate: string;
  payDate?: string | null;
  note?: string | null;
}

export interface CreatePayrollTimesheetPayload {
  payrollPeriodId: string;
  userId: string;
  outletId?: string | null;
  workDays: number;
  workHours: number;
  overtimeHours: number;
  overtimeRate: number;
  lateCount: number;
  absentDays: number;
}

export interface GeneratePayrollRunPayload {
  payrollTimesheetId: string;
  currencyCode: string;
  baseSalaryAmount?: number | null;
  netSalary?: number | null;
  note?: string | null;
}

export interface CalculateSalaryPayload {
  timesheetId: string;
  currencyCode: string;
}

export interface SalaryBreakdownView {
  basePay?: number | null;
  overtimePay?: number | null;
  overtimeHours?: number | null;
  overtimeRate?: number | null;
  standardHoursPerMonth?: number | null;
  calculationMethod?: string | null;
}

export interface CalculateSalaryResult {
  baseSalaryAmount?: number | null;
  netSalary?: number | null;
  salaryType?: string | null;
  employmentType?: string | null;
  currencyCode?: string | null;
  breakdown?: SalaryBreakdownView | null;
}

export interface ImportFromAttendancePayload {
  payrollPeriodId: string;
  userId: string;
  outletId?: string | null;
  overtimeRate?: number | null;
}

function decodePayrollPeriod(value: unknown): PayrollPeriodView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    regionId: asNullableString(record.regionId),
    name: asNullableString(record.name),
    status: asNullableString(record.status),
    startDate: asDateOnly(record.startDate),
    endDate: asDateOnly(record.endDate),
    payDate: asDateOnly(record.payDate),
    note: asNullableString(record.note),
    createdAt: asIsoDateTime(record.createdAt),
    updatedAt: asIsoDateTime(record.updatedAt),
  };
}

function decodePayrollTimesheet(value: unknown): PayrollTimesheetView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    payrollPeriodId: asNullableString(record.payrollPeriodId),
    payrollPeriodName: asNullableString(record.payrollPeriodName),
    payrollPeriodStartDate: asDateOnly(record.payrollPeriodStartDate),
    payrollPeriodEndDate: asDateOnly(record.payrollPeriodEndDate),
    outletId: asNullableString(record.outletId),
    userId: asNullableString(record.userId),
    status: asNullableString(record.status),
    workDays: asNullableNumber(record.workDays),
    workHours: asNullableNumber(record.workHours),
    overtimeHours: asNullableNumber(record.overtimeHours),
    overtimeRate: asNullableNumber(record.overtimeRate),
    lateCount: asNullableNumber(record.lateCount),
    absentDays: asNullableNumber(record.absentDays),
    approvedByUserId: asNullableString(record.approvedByUserId),
    totalHours: asNullableNumber(record.totalHours ?? asNumber(record.workHours) + asNumber(record.overtimeHours)),
    createdAt: asIsoDateTime(record.createdAt),
    updatedAt: asIsoDateTime(record.updatedAt),
  };
}

function decodePayrollRun(value: unknown): PayrollRunView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    payrollTimesheetId: asNullableString(record.payrollTimesheetId),
    payrollPeriodId: asNullableString(record.payrollPeriodId),
    payrollPeriodName: asNullableString(record.payrollPeriodName),
    outletId: asNullableString(record.outletId),
    userId: asNullableString(record.userId),
    status: asNullableString(record.status),
    totalAmount: asNullableNumber(record.totalAmount ?? record.netSalary),
    baseSalaryAmount: asNullableNumber(record.baseSalaryAmount),
    netSalary: asNullableNumber(record.netSalary),
    currencyCode: asNullableString(record.currencyCode),
    approvedByUserId: asNullableString(record.approvedByUserId),
    approvedAt: asIsoDateTime(record.approvedAt),
    paymentRef: asNullableString(record.paymentRef),
    note: asNullableString(record.note),
    createdAt: asIsoDateTime(record.createdAt),
    updatedAt: asIsoDateTime(record.updatedAt),
  };
}

export const payrollApi = {
  periods: async (token: string, query: PayrollPeriodsQuery): Promise<PagedResponse<PayrollPeriodView>> =>
    decodePaged(await apiRequest('/api/v1/payroll/periods', { token, query }), decodePayrollPeriod),
  createPeriod: async (token: string, payload: CreatePayrollPeriodPayload): Promise<PayrollPeriodView> =>
    decodePayrollPeriod(
      await apiRequest('/api/v1/payroll/periods', {
        method: 'POST',
        token,
        body: {
          regionId: Number(payload.regionId),
          name: payload.name,
          startDate: payload.startDate,
          endDate: payload.endDate,
          payDate: payload.payDate ?? null,
          note: payload.note ?? null,
        },
      }),
    ),
  timesheets: async (token: string, query: PayrollTimesheetsQuery): Promise<PagedResponse<PayrollTimesheetView>> =>
    decodePaged(await apiRequest('/api/v1/payroll/timesheets', { token, query }), decodePayrollTimesheet),
  createTimesheet: async (token: string, payload: CreatePayrollTimesheetPayload): Promise<PayrollTimesheetView> =>
    decodePayrollTimesheet(
      await apiRequest('/api/v1/payroll/timesheets', {
        method: 'POST',
        token,
        body: {
          payrollPeriodId: asString(payload.payrollPeriodId),
          userId: asString(payload.userId),
          outletId: payload.outletId ? asString(payload.outletId) : null,
          workDays: payload.workDays,
          workHours: payload.workHours,
          overtimeHours: payload.overtimeHours,
          overtimeRate: payload.overtimeRate,
          lateCount: payload.lateCount,
          absentDays: payload.absentDays,
        },
      }),
    ),
  runs: async (token: string, query: PayrollRunsQuery): Promise<PagedResponse<PayrollRunView>> =>
    decodePaged(await apiRequest('/api/v1/payroll', { token, query }), decodePayrollRun),
  calculateSalary: async (token: string, payload: CalculateSalaryPayload): Promise<CalculateSalaryResult> => {
    const raw = await apiRequest('/api/v1/payroll/calculate-salary', {
      method: 'POST',
      token,
      body: {
        timesheetId: asString(payload.timesheetId),
        currencyCode: asString(payload.currencyCode).toUpperCase(),
      },
    });
    const record = asRecord(raw) ?? {};
    const bk = asRecord(record.breakdown);
    return {
      baseSalaryAmount: asNullableNumber(record.baseSalaryAmount),
      netSalary: asNullableNumber(record.netSalary),
      salaryType: asNullableString(record.salaryType),
      employmentType: asNullableString(record.employmentType),
      currencyCode: asNullableString(record.currencyCode),
      breakdown: bk ? {
        basePay: asNullableNumber(bk.basePay),
        overtimePay: asNullableNumber(bk.overtimePay),
        overtimeHours: asNullableNumber(bk.overtimeHours),
        overtimeRate: asNullableNumber(bk.overtimeRate),
        standardHoursPerMonth: asNullableNumber(bk.standardHoursPerMonth),
        calculationMethod: asNullableString(bk.calculationMethod),
      } : null,
    };
  },
  generateRun: async (token: string, payload: GeneratePayrollRunPayload): Promise<PayrollRunView> =>
    decodePayrollRun(
      await apiRequest('/api/v1/payroll', {
        method: 'POST',
        token,
        body: {
          payrollTimesheetId: asString(payload.payrollTimesheetId),
          currencyCode: asString(payload.currencyCode).toUpperCase(),
          baseSalaryAmount: payload.baseSalaryAmount ?? null,
          netSalary: payload.netSalary ?? null,
          note: payload.note ?? null,
        },
      }),
    ),
  approveRun: async (token: string, payrollId: string): Promise<unknown> =>
    apiRequest(`/api/v1/payroll/${payrollId}/approve`, { method: 'POST', token }),
  rejectRun: async (token: string, payrollId: string, payload: { reason: string }): Promise<unknown> =>
    apiRequest(`/api/v1/payroll/${payrollId}/reject`, { method: 'POST', token, body: payload }),
  markPaid: async (token: string, payrollId: string, paymentRef?: string): Promise<unknown> =>
    apiRequest(`/api/v1/payroll/${payrollId}/mark-paid`, { method: 'POST', token, body: paymentRef ? { paymentRef } : undefined }),
  importFromAttendance: async (
    token: string,
    payload: ImportFromAttendancePayload,
  ): Promise<PayrollTimesheetView> =>
    decodePayrollTimesheet(
      await apiRequest('/api/v1/payroll/timesheets/import-from-attendance', {
        method: 'POST',
        token,
        body: {
          payrollPeriodId: asString(payload.payrollPeriodId),
          userId: asString(payload.userId),
          outletId: payload.outletId ?? null,
          overtimeRate: payload.overtimeRate ?? 1.5,
        },
      }),
    ),
};
