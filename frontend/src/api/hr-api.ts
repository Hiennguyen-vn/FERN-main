import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArray, decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord, asString } from '@/api/records';

export interface ShiftView {
  id: string;
  outletId?: string | null;
  code?: string | null;
  name?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface WorkShiftView {
  id: string;
  outletId?: string | null;
  userId?: string | null;
  status?: string | null;
  workDate?: string | null;
  totalHours?: number | null;
  [key: string]: unknown;
}

export interface ContractView {
  id: string;
  userId?: string | null;
  outletId?: string | null;
  employmentType?: string | null;
  salaryType?: string | null;
  baseSalary?: number | null;
  currencyCode?: string | null;
  regionCode?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  [key: string]: unknown;
}

export interface ShiftsQuery {
  outletId?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface WorkShiftsQuery {
  outletId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ContractsQuery {
  q?: string;
  userId?: string;
  outletId?: string;
  status?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  startDateFrom?: string;
  startDateTo?: string;
  endDateFrom?: string;
  endDateTo?: string;
  limit?: number;
  offset?: number;
}

function decodeShift(value: unknown): ShiftView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    code: asNullableString(record.code),
    name: asNullableString(record.name),
    status: asNullableString(record.status),
  };
}

function decodeWorkShift(value: unknown): WorkShiftView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    userId: asNullableString(record.userId),
    status: asNullableString(record.status),
    workDate: asDateOnly(record.workDate),
    totalHours: asNullableNumber(record.totalHours),
  };
}

function decodeContract(value: unknown): ContractView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    userId: asNullableString(record.userId),
    outletId: asNullableString(record.outletId),
    employmentType: asNullableString(record.employmentType),
    salaryType: asNullableString(record.salaryType),
    baseSalary: asNullableNumber(record.baseSalary),
    currencyCode: asNullableString(record.currencyCode ? asString(record.currencyCode).toUpperCase() : null),
    regionCode: asNullableString(record.regionCode),
    status: asNullableString(record.status),
    startDate: asDateOnly(record.startDate),
    endDate: asDateOnly(record.endDate),
  };
}

export const hrApi = {
  shifts: async (token: string, outletId?: string): Promise<ShiftView[]> =>
    decodeArray(await apiRequest('/api/v1/hr/shifts', { token, query: { outletId } }), decodeShift),
  shiftsPaged: async (token: string, query: ShiftsQuery): Promise<PagedResponse<ShiftView>> =>
    decodePaged(await apiRequest('/api/v1/hr/shifts', { token, query }), decodeShift),
  workShifts: async (token: string, query: WorkShiftsQuery): Promise<WorkShiftView[]> =>
    decodeArray(await apiRequest('/api/v1/hr/work-shifts', { token, query }), decodeWorkShift),
  workShiftsPaged: async (token: string, query: WorkShiftsQuery): Promise<PagedResponse<WorkShiftView>> =>
    decodePaged(await apiRequest('/api/v1/hr/work-shifts', { token, query }), decodeWorkShift),
  workShiftsByOutletDate: async (token: string, outletId: string, date: string): Promise<WorkShiftView[]> =>
    decodeArray(await apiRequest(`/api/v1/hr/work-shifts/outlet/${outletId}/date/${date}`, { token }), decodeWorkShift),
  contracts: async (token: string, query: ContractsQuery): Promise<ContractView[]> =>
    decodeArray(await apiRequest('/api/v1/hr/contracts', { token, query }), decodeContract),
  contractsPaged: async (token: string, query: ContractsQuery): Promise<PagedResponse<ContractView>> =>
    decodePaged(await apiRequest('/api/v1/hr/contracts', { token, query }), decodeContract),
  contractsActive: async (token: string): Promise<ContractView[]> =>
    decodeArray(await apiRequest('/api/v1/hr/contracts/active', { token }), decodeContract),
  createShift: async (token: string, payload: unknown): Promise<unknown> =>
    apiRequest('/api/v1/hr/shifts', { method: 'POST', token, body: payload }),
  updateAttendance: async (token: string, workShiftId: string, payload: unknown): Promise<unknown> =>
    apiRequest(`/api/v1/hr/work-shifts/${workShiftId}/attendance`, { method: 'PUT', token, body: payload }),
};
