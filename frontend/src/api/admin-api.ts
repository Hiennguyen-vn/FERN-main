import { apiRequest } from '@/api/client';

export interface PriceDriftRow {
  saleId: number;
  productId: number;
  outletId: number;
  unitPrice: string;
  currentPriceAtSync: string;
  priceDriftAmount: string;
  qty: string;
  createdAt: string;
}

export interface DltRow {
  id: number;
  aggregateType: string;
  aggregateId: number;
  topic: string;
  status: string;
  dlqStatus: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface CashSummary {
  sessionId: number;
  outletId: number;
  businessDate: string | null;
  openFloat: string;
  salesCash: string;
  paidIn: string;
  paidOut: string;
  drops: string;
  counted: string | null;
  expectedTotal: string;
  variance: string | null;
}

export interface LoyaltyCustomer {
  id: number;
  phone: string;
  fullName: string | null;
  birthday: string | null;
  pointsBalance: number;
  phoneVerified: boolean;
  consentMarketing: boolean;
  consentDataProcessing: boolean;
}

export async function fetchPriceDrift(params: {
  outletIds?: number[];
  from: string;
  to: string;
  limit?: number;
}): Promise<{ items: PriceDriftRow[]; count: number }> {
  const qs = new URLSearchParams();
  qs.set('from', params.from);
  qs.set('to', params.to);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.outletIds) params.outletIds.forEach(id => qs.append('outletId', String(id)));
  return apiRequest(`/api/v1/admin/reports/price-drift?${qs.toString()}`);
}

export async function fetchDltPending(limit: number = 100): Promise<{ items: DltRow[]; count: number }> {
  return apiRequest(`/api/v1/admin/reports/dlt?limit=${limit}`);
}

export async function replayDlt(eventId: number): Promise<{ eventId: number; requeued: boolean }> {
  return apiRequest(`/api/v1/admin/reports/dlt/${eventId}/replay`, { method: 'POST' });
}

export async function fetchCashSummary(sessionId: number): Promise<CashSummary> {
  return apiRequest(`/api/v1/admin/reports/cash-summary/${sessionId}`);
}

export async function lookupCustomer(phone: string): Promise<LoyaltyCustomer> {
  return apiRequest(`/api/v1/loyalty/customers?phone=${encodeURIComponent(phone)}`);
}

export async function eraseCustomer(id: number): Promise<void> {
  await apiRequest(`/api/v1/loyalty/customers/${id}`, { method: 'DELETE' });
}
