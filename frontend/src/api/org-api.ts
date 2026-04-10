import { apiRequest } from '@/api/client';
import { asId, asNullableString, asRecord, asRecordArray, asString } from '@/api/records';

export interface ScopeOutlet {
  id: string;
  regionId: string;
  code: string;
  name: string;
  status: string;
  address?: string | null;
  [key: string]: unknown;
}

export interface ScopeRegion {
  id: string;
  code: string;
  parentRegionId?: string | null;
  currencyCode?: string | null;
  name: string;
  [key: string]: unknown;
}

export interface OrgHierarchy {
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}

export interface CreateOutletPayload {
  code: string;
  name: string;
  regionId: string;
  address?: string | null;
  status?: string | null;
}

export interface ExchangeRatePayload {
  fromCurrencyCode: string;
  toCurrencyCode: string;
  rate: number;
  onDate: string;
}

function decodeRegion(value: unknown): ScopeRegion {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    code: asString(record.code),
    parentRegionId: asNullableString(record.parentRegionId),
    currencyCode: asNullableString(record.currencyCode),
    name: asString(record.name),
  };
}

function decodeOutlet(value: unknown): ScopeOutlet {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    regionId: asId(record.regionId),
    code: asString(record.code),
    name: asString(record.name),
    status: asString(record.status),
    address: asNullableString(record.address),
  };
}

export const orgApi = {
  hierarchy: async (token: string): Promise<OrgHierarchy> => {
    const result = asRecord(await apiRequest('/api/v1/org/hierarchy', { token })) ?? {};
    return {
      regions: asRecordArray(result.regions).map(decodeRegion),
      outlets: asRecordArray(result.outlets).map(decodeOutlet),
    };
  },
  outlets: async (token: string, regionId?: string): Promise<ScopeOutlet[]> => {
    const result = await apiRequest('/api/v1/org/outlets', { token, query: { regionId } });
    return (Array.isArray(result) ? result : []).map(decodeOutlet);
  },
  exchangeRate: async (token: string, from: string, to: string, on?: string): Promise<unknown> =>
    apiRequest('/api/v1/org/exchange-rates', { token, query: { from, to, on } }),
  createOutlet: async (token: string, payload: CreateOutletPayload): Promise<unknown> =>
    apiRequest('/api/v1/org/outlets', { method: 'POST', token, body: payload }),
  upsertExchangeRate: async (token: string, payload: ExchangeRatePayload): Promise<unknown> =>
    apiRequest('/api/v1/org/exchange-rates', { method: 'PUT', token, body: payload }),
};
