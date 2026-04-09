import { apiRequest } from '@/api/client';

export const gatewayApi = {
  info: async (): Promise<unknown> => apiRequest('/api/v1/gateway/info'),
};

