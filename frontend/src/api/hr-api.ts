import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArray, decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord, asString } from '@/api/records';

export interface ShiftView {
  id: string;
  outletId?: string | null;
  code?: string | null;
  name?: string | null;
  status?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number | null;
  [key: string]: unknown;
}

export interface WorkShiftView {
  id: string;
  outletId?: string | null;
  shiftId?: string | null;
  userId?: string | null;
  scheduleStatus?: string | null;
  attendanceStatus?: string | null;
  approvalStatus?: string | null;
  workDate?: string | null;
  totalHours?: number | null;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  assignedByUserId?: string | null;
  approvedByUserId?: string | null;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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
  userId?: string;
  outletId?: string;
  startDate?: string;
  endDate?: string;
  scheduleStatus?: string;
  attendanceStatus?: string;
  approvalStatus?: string;
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

export interface CreateWorkShiftPayload {
  shiftId: string;
  userId: string;
  workDate: string;
  note?: string | null;
  scheduleStatus?: string | null;
  attendanceStatus?: string | null;
  approvalStatus?: string | null;
}

export interface CreateContractPayload {
  userId: string;
  outletId?: string | null;
  employmentType: string;
  salaryType: string;
  baseSalary: number;
  currencyCode: string;
  regionCode?: string | null;
  startDate: string;
  endDate?: string | null;
  taxCode?: string | null;
  bankAccount?: string | null;
}

export interface TerminateContractPayload {
  endDate?: string | null;
}

export interface TimeOffQuery {
  userId?: string;
  outletId?: string;
  approvalStatus?: string;
  startDate?: string;
  endDate?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
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
    startTime: asNullableString(record.startTime),
    endTime: asNullableString(record.endTime),
    breakMinutes: asNullableNumber(record.breakMinutes),
  };
}

function decodeWorkShift(value: unknown): WorkShiftView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    shiftId: asNullableString(record.shiftId),
    userId: asNullableString(record.userId),
    scheduleStatus: asNullableString(record.scheduleStatus),
    attendanceStatus: asNullableString(record.attendanceStatus),
    approvalStatus: asNullableString(record.approvalStatus),
    workDate: asDateOnly(record.workDate),
    totalHours: asNullableNumber(record.totalHours),
    actualStartTime: asNullableString(record.actualStartTime),
    actualEndTime: asNullableString(record.actualEndTime),
    assignedByUserId: asNullableString(record.assignedByUserId),
    approvedByUserId: asNullableString(record.approvedByUserId),
    note: asNullableString(record.note),
    createdAt: asNullableString(record.createdAt),
    updatedAt: asNullableString(record.updatedAt),
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
    decodePaged(
      await apiRequest('/api/v1/hr/shifts', {
        token,
        query: {
          outletId,
          sortBy: 'startTime',
          sortDir: 'asc',
          limit: 200,
          offset: 0,
        },
      }),
      decodeShift,
    ).items,
  shiftsPaged: async (token: string, query: ShiftsQuery): Promise<PagedResponse<ShiftView>> =>
    decodePaged(await apiRequest('/api/v1/hr/shifts', { token, query }), decodeShift),
  workShifts: async (token: string, query: WorkShiftsQuery): Promise<WorkShiftView[]> =>
    decodePaged(await apiRequest('/api/v1/hr/work-shifts', { token, query }), decodeWorkShift).items,
  workShiftsPaged: async (token: string, query: WorkShiftsQuery): Promise<PagedResponse<WorkShiftView>> =>
    decodePaged(await apiRequest('/api/v1/hr/work-shifts', { token, query }), decodeWorkShift),
  workShiftsByOutletDate: async (token: string, outletId: string, date: string): Promise<WorkShiftView[]> =>
    decodeArray(await apiRequest(`/api/v1/hr/work-shifts/outlet/${outletId}/date/${date}`, { token }), decodeWorkShift),
  timeOffPaged: async (token: string, query: TimeOffQuery): Promise<PagedResponse<WorkShiftView>> =>
    decodePaged(await apiRequest('/api/v1/hr/time-off', { token, query }), decodeWorkShift),
  contracts: async (token: string, query: ContractsQuery): Promise<ContractView[]> =>
    decodeArray(await apiRequest('/api/v1/hr/contracts', { token, query }), decodeContract),
  contractsPaged: async (token: string, query: ContractsQuery): Promise<PagedResponse<ContractView>> =>
    decodePaged(await apiRequest('/api/v1/hr/contracts', { token, query }), decodeContract),
  contractsActive: async (token: string): Promise<ContractView[]> =>
    decodeArray(await apiRequest('/api/v1/hr/contracts/active', { token }), decodeContract),
  createShift: async (token: string, payload: unknown): Promise<unknown> =>
    apiRequest('/api/v1/hr/shifts', { method: 'POST', token, body: payload }),
  createWorkShift: async (token: string, payload: CreateWorkShiftPayload): Promise<WorkShiftView> =>
    decodeWorkShift(
      await apiRequest('/api/v1/hr/work-shifts', {
        method: 'POST',
        token,
        body: {
          shiftId: String(payload.shiftId),
          userId: String(payload.userId),
          workDate: payload.workDate,
          scheduleStatus: payload.scheduleStatus ?? null,
          attendanceStatus: payload.attendanceStatus ?? null,
          approvalStatus: payload.approvalStatus ?? null,
          note: payload.note ?? null,
        },
      }),
    ),
  updateAttendance: async (token: string, workShiftId: string, payload: unknown): Promise<unknown> =>
    apiRequest(`/api/v1/hr/work-shifts/${workShiftId}/attendance`, { method: 'PUT', token, body: payload }),
  approveWorkShift: async (token: string, workShiftId: string): Promise<unknown> =>
    apiRequest(`/api/v1/hr/work-shifts/${workShiftId}/approve`, { method: 'POST', token }),
  rejectWorkShift: async (token: string, workShiftId: string, payload?: { reason?: string | null }): Promise<unknown> =>
    apiRequest(`/api/v1/hr/work-shifts/${workShiftId}/reject`, { method: 'POST', token, body: payload ?? {} }),
  createContract: async (token: string, payload: CreateContractPayload): Promise<ContractView> =>
    decodeContract(
      await apiRequest('/api/v1/hr/contracts', {
        method: 'POST',
        token,
        body: {
          userId: String(payload.userId),
          outletId: payload.outletId ? String(payload.outletId) : null,
          employmentType: payload.employmentType,
          salaryType: payload.salaryType,
          baseSalary: payload.baseSalary,
          currencyCode: payload.currencyCode.toUpperCase(),
          regionCode: payload.regionCode ?? null,
          startDate: payload.startDate,
          endDate: payload.endDate ?? null,
          taxCode: payload.taxCode ?? null,
          bankAccount: payload.bankAccount ?? null,
        },
      }),
    ),
  terminateContract: async (token: string, contractId: string, payload?: TerminateContractPayload): Promise<unknown> =>
    apiRequest(`/api/v1/hr/contracts/${contractId}/terminate`, { method: 'POST', token, body: payload ?? {} }),
};
