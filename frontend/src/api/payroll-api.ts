import { apiRequest, type PagedResponse } from '@/api/client';
import { decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord } from '@/api/records';

export interface PayrollPeriodView {
  id: string;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  [key: string]: unknown;
}

export interface PayrollTimesheetView {
  id: string;
  outletId?: string | null;
  userId?: string | null;
  status?: string | null;
  totalHours?: number | null;
  [key: string]: unknown;
}

export interface PayrollRunView {
  id: string;
  outletId?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  currencyCode?: string | null;
  [key: string]: unknown;
}

export interface PayrollPeriodsQuery {
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PayrollTimesheetsQuery {
  outletId?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PayrollRunsQuery {
  outletId?: string;
  status?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function decodePayrollPeriod(value: unknown): PayrollPeriodView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    status: asNullableString(record.status),
    startDate: asDateOnly(record.startDate),
    endDate: asDateOnly(record.endDate),
  };
}

function decodePayrollTimesheet(value: unknown): PayrollTimesheetView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    userId: asNullableString(record.userId),
    status: asNullableString(record.status),
    totalHours: asNullableNumber(record.totalHours),
  };
}

function decodePayrollRun(value: unknown): PayrollRunView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    status: asNullableString(record.status),
    totalAmount: asNullableNumber(record.totalAmount),
    currencyCode: asNullableString(record.currencyCode),
  };
}

export const payrollApi = {
  periods: async (token: string, query: PayrollPeriodsQuery): Promise<PagedResponse<PayrollPeriodView>> =>
    decodePaged(await apiRequest('/api/v1/payroll/periods', { token, query }), decodePayrollPeriod),
  timesheets: async (token: string, query: PayrollTimesheetsQuery): Promise<PagedResponse<PayrollTimesheetView>> =>
    decodePaged(await apiRequest('/api/v1/payroll/timesheets', { token, query }), decodePayrollTimesheet),
  runs: async (token: string, query: PayrollRunsQuery): Promise<PagedResponse<PayrollRunView>> =>
    decodePaged(await apiRequest('/api/v1/payroll', { token, query }), decodePayrollRun),
  approveRun: async (token: string, payrollId: string): Promise<unknown> =>
    apiRequest(`/api/v1/payroll/${payrollId}/approve`, { method: 'POST', token }),
};

