import { apiRequest } from '@/api/client';

export const reportsApi = {
  sales: async (token: string, outletId: string, startDate: string, endDate: string): Promise<unknown> =>
    apiRequest('/api/v1/reports/sales', { token, query: { outletId, startDate, endDate } }),
  expenses: async (token: string, outletId: string, startDate: string, endDate: string): Promise<unknown> =>
    apiRequest('/api/v1/reports/expenses', { token, query: { outletId, startDate, endDate } }),
  inventoryMovements: async (
    token: string,
    outletId: string,
    startDate: string,
    endDate: string,
    itemId?: string,
  ): Promise<unknown> =>
    apiRequest('/api/v1/reports/inventory-movements', { token, query: { outletId, startDate, endDate, itemId } }),
  lowStock: async (token: string, outletId: string): Promise<unknown> =>
    apiRequest('/api/v1/reports/low-stock', { token, query: { outletId } }),
};

