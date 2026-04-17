import { apiRequest } from '@/api/client';
import { asDateOnly, asId, asNullableString, asRecord, asRecordArray, asString } from '@/api/records';

export interface ScopeOutlet {
  id: string;
  regionId: string;
  code: string;
  name: string;
  status: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
  [key: string]: unknown;
}

export interface ScopeRegion {
  id: string;
  code: string;
  parentRegionId?: string | null;
  currencyCode?: string | null;
  taxCode?: string | null;
  timezoneName?: string | null;
  name: string;
  [key: string]: unknown;
}

export interface OrgHierarchy {
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}

export interface CreateRegionPayload {
  code: string;
  name: string;
  parentRegionId?: string | null;
  currencyCode: string;
  taxCode?: string | null;
  timezoneName: string;
}

export interface UpdateRegionPayload {
  name: string;
  parentRegionId?: string | null;
  currencyCode: string;
  taxCode?: string | null;
  timezoneName: string;
}

export interface CreateOutletPayload {
  code: string;
  name: string;
  regionId: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
}

export interface UpdateOutletPayload {
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
}

export interface UpdateOutletStatusPayload {
  targetStatus: string;
  reason?: string | null;
}

export interface ExchangeRateView {
  fromCurrencyCode: string;
  toCurrencyCode: string;
  rate: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface ExchangeRatePayload {
  fromCurrencyCode: string;
  toCurrencyCode: string;
  rate: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

function decodeRegion(value: unknown): ScopeRegion {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    code: asString(record.code),
    parentRegionId: asNullableString(record.parentRegionId),
    currencyCode: asNullableString(record.currencyCode),
    taxCode: asNullableString(record.taxCode),
    timezoneName: asNullableString(record.timezoneName),
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
    phone: asNullableString(record.phone),
    email: asNullableString(record.email),
    openedAt: asDateOnly(record.openedAt),
    closedAt: asDateOnly(record.closedAt),
  };
}

function decodeExchangeRate(value: unknown): ExchangeRateView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    fromCurrencyCode: asString(record.fromCurrencyCode),
    toCurrencyCode: asString(record.toCurrencyCode),
    rate: asString(record.rate),
    effectiveFrom: asDateOnly(record.effectiveFrom),
    effectiveTo: asDateOnly(record.effectiveTo),
    updatedAt: asNullableString(record.updatedAt),
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
  regions: async (token: string): Promise<ScopeRegion[]> => {
    const result = await apiRequest('/api/v1/org/regions', { token });
    return (Array.isArray(result) ? result : []).map(decodeRegion);
  },
  region: async (token: string, code: string): Promise<ScopeRegion> =>
    decodeRegion(await apiRequest(`/api/v1/org/regions/${encodeURIComponent(code)}`, { token })),
  createRegion: async (token: string, payload: CreateRegionPayload): Promise<ScopeRegion> =>
    decodeRegion(await apiRequest('/api/v1/org/regions', { method: 'POST', token, body: payload })),
  updateRegion: async (token: string, code: string, payload: UpdateRegionPayload): Promise<ScopeRegion> =>
    decodeRegion(await apiRequest(`/api/v1/org/regions/${encodeURIComponent(code)}`, { method: 'PUT', token, body: payload })),
  outlets: async (token: string, regionId?: string): Promise<ScopeOutlet[]> => {
    const result = await apiRequest('/api/v1/org/outlets', { token, query: { regionId } });
    return (Array.isArray(result) ? result : []).map(decodeOutlet);
  },
  outlet: async (token: string, outletId: string): Promise<ScopeOutlet> =>
    decodeOutlet(await apiRequest(`/api/v1/org/outlets/${encodeURIComponent(outletId)}`, { token })),
  createOutlet: async (token: string, payload: CreateOutletPayload): Promise<ScopeOutlet> =>
    decodeOutlet(await apiRequest('/api/v1/org/outlets', { method: 'POST', token, body: payload })),
  updateOutlet: async (token: string, outletId: string, payload: UpdateOutletPayload): Promise<ScopeOutlet> =>
    decodeOutlet(await apiRequest(`/api/v1/org/outlets/${encodeURIComponent(outletId)}`, { method: 'PUT', token, body: payload })),
  updateOutletStatus: async (token: string, outletId: string, payload: UpdateOutletStatusPayload): Promise<ScopeOutlet> =>
    decodeOutlet(await apiRequest(`/api/v1/org/outlets/${encodeURIComponent(outletId)}/status`, { method: 'POST', token, body: payload })),
  exchangeRate: async (token: string, from: string, to: string, on?: string): Promise<ExchangeRateView> =>
    decodeExchangeRate(await apiRequest('/api/v1/org/exchange-rates', { token, query: { from, to, on } })),
  upsertExchangeRate: async (token: string, payload: ExchangeRatePayload): Promise<ExchangeRateView> =>
    decodeExchangeRate(await apiRequest('/api/v1/org/exchange-rates', { method: 'PUT', token, body: payload })),
};
