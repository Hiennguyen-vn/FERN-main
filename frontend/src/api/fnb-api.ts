import { apiRequest } from '@/api/client';

// ── Modifier groups ──────────────────────────────────────────────────────────

export interface ModifierOptionView {
  id: number;
  code: string;
  label: string;
  priceDelta: number;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
}

export interface ModifierGroupView {
  id: number;
  code: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTI';
  minSelect: number;
  maxSelect: number;
  required: boolean;
  active: boolean;
  options: ModifierOptionView[];
}

export const fnbApi = {
  listModifierGroups: (token: string): Promise<ModifierGroupView[]> =>
    apiRequest('/api/v1/modifier-groups', { token }) as Promise<ModifierGroupView[]>,
  getModifierGroup: (token: string, groupId: string | number): Promise<ModifierGroupView> =>
    apiRequest(`/api/v1/modifier-groups/${groupId}`, { token }) as Promise<ModifierGroupView>,
  createModifierGroup: (token: string, body: unknown): Promise<ModifierGroupView> =>
    apiRequest('/api/v1/modifier-groups', { method: 'POST', token, body }) as Promise<ModifierGroupView>,
  updateModifierGroup: (token: string, groupId: string | number, body: unknown): Promise<ModifierGroupView> =>
    apiRequest(`/api/v1/modifier-groups/${groupId}`, { method: 'PUT', token, body }) as Promise<ModifierGroupView>,
  deleteModifierGroup: (token: string, groupId: string | number): Promise<void> =>
    apiRequest(`/api/v1/modifier-groups/${groupId}`, { method: 'DELETE', token }) as Promise<void>,
  getProductModifierGroups: (token: string, productId: string | number): Promise<ModifierGroupView[]> =>
    apiRequest(`/api/v1/products/${productId}/modifier-groups`, { token }) as Promise<ModifierGroupView[]>,
  assignProductModifierGroups: (
    token: string,
    productId: string | number,
    groups: { groupId: number; sortOrder?: number }[],
  ): Promise<ModifierGroupView[]> =>
    apiRequest(`/api/v1/products/${productId}/modifier-groups`, {
      method: 'PUT',
      token,
      body: { groups },
    }) as Promise<ModifierGroupView[]>,
};
