import { apiRequest, type PagedResponse } from '@/api/client';
import { decodePaged } from '@/api/decoders';
import { asId, asNullableString, asNumber, asRecord } from '@/api/records';

export interface CrmCustomerView {
  id: string;
  referenceType?: string | null;
  displayName?: string | null;
  outletId: string;
  outletCode?: string | null;
  outletName?: string | null;
  orderCount: number;
  totalSpend: string;
  lastOrderAt?: string | null;
  [key: string]: unknown;
}

export interface CrmCustomersQuery {
  outletId?: string;
  q?: string;
  query?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function decodeCustomer(value: unknown): CrmCustomerView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    referenceType: asNullableString(record.referenceType),
    displayName: asNullableString(record.displayName),
    outletId: asId(record.outletId),
    outletCode: asNullableString(record.outletCode),
    outletName: asNullableString(record.outletName),
    orderCount: asNumber(record.orderCount, 0),
    totalSpend: String(record.totalSpend ?? '0'),
    lastOrderAt: asNullableString(record.lastOrderAt),
  };
}

export const crmApi = {
  customers: async (token: string, query: CrmCustomersQuery): Promise<PagedResponse<CrmCustomerView>> => {
    const normalizedQuery = {
      ...query,
      q: query.q ?? query.query,
      query: query.query ?? query.q,
    };
    return decodePaged(await apiRequest('/api/v1/crm/customers', { token, query: normalizedQuery }), decodeCustomer);
  },
};

