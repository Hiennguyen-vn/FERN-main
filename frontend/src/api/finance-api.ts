import { apiRequest, type PagedResponse } from '@/api/client';
import { decodePaged } from '@/api/decoders';
import { asDateOnly, asId, asNullableNumber, asNullableString, asRecord } from '@/api/records';

export interface ExpenseView {
  id: string;
  outletId?: string | null;
  businessDate?: string | null;
  currencyCode?: string | null;
  amount?: number | null;
  sourceType?: string | null;
  subtype?: string | null;
  description?: string | null;
  createdByUserId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface FinanceExpensesQuery {
  outletId?: string;
  sourceType?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CreateExpensePayload {
  outletId: string | number;
  businessDate: string;
  currencyCode: string;
  amount: number;
  description: string;
  note?: string | null;
}

function decodeExpense(value: unknown): ExpenseView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    outletId: asNullableString(record.outletId),
    businessDate: asDateOnly(record.businessDate),
    currencyCode: asNullableString(record.currencyCode),
    amount: asNullableNumber(record.amount),
    sourceType: asNullableString(record.sourceType),
    subtype: asNullableString(record.subtype),
    description: asNullableString(record.description),
    createdByUserId: asNullableString(record.createdByUserId),
    createdAt: asNullableString(record.createdAt),
    updatedAt: asNullableString(record.updatedAt),
  };
}

export const financeApi = {
  expenses: async (token: string, query: FinanceExpensesQuery): Promise<PagedResponse<ExpenseView>> =>
    decodePaged(await apiRequest('/api/v1/finance/expenses', { token, query }), decodeExpense),
  expenseDetail: async (token: string, expenseId: string): Promise<ExpenseView> =>
    decodeExpense(await apiRequest(`/api/v1/finance/expenses/${expenseId}`, { token })),
  createOperatingExpense: async (token: string, payload: CreateExpensePayload): Promise<unknown> =>
    apiRequest('/api/v1/finance/expenses/operating', { method: 'POST', token, body: payload }),
  createOtherExpense: async (token: string, payload: CreateExpensePayload): Promise<unknown> =>
    apiRequest('/api/v1/finance/expenses/other', { method: 'POST', token, body: payload }),
};

