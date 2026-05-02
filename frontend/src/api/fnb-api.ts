import { apiRequest } from '@/api/client';

// ── Allergens ────────────────────────────────────────────────────────────────

export interface AllergenView {
  code: string;
  label: string;
  labelEn: string;
  icon: string | null;
  sortOrder: number;
}

export interface ProductAllergenView extends AllergenView {
  isTraces: boolean;
}

export interface CustomerAllergyView extends AllergenView {
  severity: 'NOTE' | 'AVOID' | 'SEVERE';
  note: string | null;
}

export interface ProductAllergenInput {
  code: string;
  isTraces: boolean;
}

export interface CustomerAllergyInput {
  code: string;
  severity: 'NOTE' | 'AVOID' | 'SEVERE';
  note?: string | null;
}

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
  // Allergens.
  listAllergens: (token: string): Promise<AllergenView[]> =>
    apiRequest('/api/v1/allergens', { token }) as Promise<AllergenView[]>,
  getProductAllergens: (token: string, productId: string | number): Promise<ProductAllergenView[]> =>
    apiRequest(`/api/v1/products/${productId}/allergens`, { token }) as Promise<ProductAllergenView[]>,
  listAllProductAllergens: (token: string): Promise<{ productId: number; allergens: ProductAllergenView[] }[]> =>
    apiRequest('/api/v1/product-allergens', { token }) as Promise<{ productId: number; allergens: ProductAllergenView[] }[]>,
  setProductAllergens: (
    token: string,
    productId: string | number,
    allergens: ProductAllergenInput[],
  ): Promise<ProductAllergenView[]> =>
    apiRequest(`/api/v1/products/${productId}/allergens`, {
      method: 'PUT',
      token,
      body: { allergens },
    }) as Promise<ProductAllergenView[]>,
  getCustomerAllergies: (token: string, customerId: string | number): Promise<CustomerAllergyView[]> =>
    apiRequest(`/api/v1/customer-allergies/${customerId}`, { token }) as Promise<CustomerAllergyView[]>,
  setCustomerAllergies: (
    token: string,
    customerId: string | number,
    allergies: CustomerAllergyInput[],
  ): Promise<CustomerAllergyView[]> =>
    apiRequest(`/api/v1/customer-allergies/${customerId}`, {
      method: 'PUT',
      token,
      body: { allergies },
    }) as Promise<CustomerAllergyView[]>,

  // Modifier groups.
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
