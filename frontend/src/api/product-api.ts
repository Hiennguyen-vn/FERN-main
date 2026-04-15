import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArrayFromPageOrArray, decodePaged } from '@/api/decoders';
import {
  asDateOnly,
  asId,
  asNullableNumber,
  asNullableString,
  asRecord,
  asString,
} from '@/api/records';

export interface ProductView {
  id: string;
  code?: string | null;
  name?: string | null;
  categoryCode?: string | null;
  status?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

export interface ItemView {
  id: string;
  code?: string | null;
  name?: string | null;
  categoryCode?: string | null;
  unitCode?: string | null;
  baseUomCode?: string | null;
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface PriceView {
  id: string;
  productId?: string | null;
  outletId?: string | null;
  currencyCode?: string | null;
  priceValue: number;
  priceAmount: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  [key: string]: unknown;
}

export interface RecipeLineItemView {
  itemId?: string | null;
  qtyRequired?: number | null;
  uomCode?: string | null;
  [key: string]: unknown;
}

export interface RecipeView {
  productId?: string | null;
  version?: string | null;
  yieldQty?: number | null;
  yieldUomCode?: string | null;
  status?: string | null;
  items?: RecipeLineItemView[];
  [key: string]: unknown;
}

export interface ProductsQuery {
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ItemsQuery {
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PricesQuery {
  outletId?: string;
  on?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CategoryView {
  code: string;
  name: string;
  isActive: boolean;
  description?: string | null;
}

export interface MenuItemView {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  productStatus: string;
  displayOrder: number;
  isActive: boolean;
}

export interface MenuCategoryView {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  items: MenuItemView[];
}

export interface MenuView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  scopeType: string;
  scopeId: string | null;
  categories: MenuCategoryView[];
}

export interface ChannelView {
  code: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
}

export interface DaypartView {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  displayOrder: number;
}

export interface PublishVersionView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdByUserId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNote: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  rolledBackAt: string | null;
  rollbackReason: string | null;
  itemCount: number;
  createdAt: string;
}

export interface PublishItemView {
  id: string;
  entityType: string;
  entityId: string;
  changeType: string;
  scopeType: string | null;
  scopeId: string | null;
  summary: string;
  beforeSnapshot: string | null;
  afterSnapshot: string | null;
  createdAt: string;
}

export interface AuditLogView {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  scopeType: string | null;
  scopeId: string | null;
  userId: string | null;
  username: string | null;
  publishVersionId: string | null;
  createdAt: string;
}

export interface CreateProductPayload {
  code: string;
  name: string;
  categoryCode?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface CreateItemPayload {
  code: string;
  name: string;
  categoryCode?: string | null;
  unitCode?: string | null;
  baseUomCode?: string | null;
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
}

export interface UpsertPricePayload {
  productId: string | number;
  outletId: string | number;
  currencyCode?: string;
  priceValue?: number | null;
  priceAmount?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface AvailabilityView {
  productId: string;
  outletId: string;
  available: boolean;
}

export interface UpsertRecipePayload {
  version: string;
  yieldQty: number;
  yieldUomCode: string;
  status?: string | null;
  items: Array<{ itemId: string | number; qty?: number; qtyRequired?: number; uomCode: string }>;
}

function toLongValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function trimToNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function decodeProduct(value: unknown): ProductView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    code: asNullableString(record.code),
    name: asNullableString(record.name),
    categoryCode: asNullableString(record.categoryCode),
    status: asNullableString(record.status),
    imageUrl: asNullableString(record.imageUrl),
    description: asNullableString(record.description),
  };
}

function decodeItem(value: unknown): ItemView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    code: asNullableString(record.code),
    name: asNullableString(record.name),
    categoryCode: asNullableString(record.categoryCode),
    unitCode: asNullableString(record.unitCode),
    baseUomCode: asNullableString(record.baseUomCode),
    minStockLevel: asNullableNumber(record.minStockLevel),
    maxStockLevel: asNullableNumber(record.maxStockLevel),
    status: asNullableString(record.status),
  };
}

function decodePrice(value: unknown): PriceView {
  const record = asRecord(value) ?? {};
  const priceValue = Number(record.priceValue ?? record.priceAmount ?? 0);
  return {
    ...record,
    id: asId(record.id ?? `${record.productId ?? ''}:${record.outletId ?? ''}:${record.effectiveFrom ?? ''}`),
    productId: asNullableString(record.productId),
    outletId: asNullableString(record.outletId),
    currencyCode: asNullableString(record.currencyCode),
    priceValue: Number.isFinite(priceValue) ? priceValue : 0,
    priceAmount: Number.isFinite(priceValue) ? priceValue : 0,
    effectiveFrom: asDateOnly(record.effectiveFrom),
    effectiveTo: asDateOnly(record.effectiveTo),
  };
}

function decodeRecipe(value: unknown): RecipeView {
  const record = asRecord(value) ?? {};
  const items = Array.isArray(record.items)
    ? record.items.map((item) => {
        const itemRecord = asRecord(item) ?? {};
        return {
          ...itemRecord,
          itemId: asNullableString(itemRecord.itemId),
          qtyRequired: asNullableNumber(itemRecord.qtyRequired ?? itemRecord.qty),
          uomCode: asNullableString(itemRecord.uomCode),
        };
      })
    : [];
  return {
    ...record,
    productId: asNullableString(record.productId),
    version: asNullableString(record.version),
    yieldQty: asNullableNumber(record.yieldQty),
    yieldUomCode: asNullableString(record.yieldUomCode),
    status: asNullableString(record.status),
    items,
  };
}

function decodeAvailability(value: unknown): AvailabilityView {
  const record = asRecord(value) ?? {};
  return {
    productId: asId(record.productId),
    outletId: asId(record.outletId),
    available: Boolean(record.available ?? record.isAvailable ?? false),
  };
}

export const productApi = {
  products: async (token: string): Promise<ProductView[]> =>
    decodeArrayFromPageOrArray(await apiRequest('/api/v1/product/products', { token }), decodeProduct),
  productsPaged: async (token: string, query: ProductsQuery): Promise<PagedResponse<ProductView>> =>
    decodePaged(await apiRequest('/api/v1/product/products', { token, query }), decodeProduct),
  createProduct: async (token: string, payload: CreateProductPayload): Promise<unknown> =>
    apiRequest('/api/v1/product/products', {
      method: 'POST',
      token,
      body: {
        code: asString(payload.code).trim(),
        name: asString(payload.name).trim(),
        categoryCode: trimToNull(payload.categoryCode),
        imageUrl: payload.imageUrl ?? null,
        description: payload.description ?? null,
      },
    }),
  items: async (token: string): Promise<ItemView[]> =>
    decodeArrayFromPageOrArray(await apiRequest('/api/v1/product/items', { token }), decodeItem),
  itemsPaged: async (token: string, query: ItemsQuery): Promise<PagedResponse<ItemView>> =>
    decodePaged(await apiRequest('/api/v1/product/items', { token, query }), decodeItem),
  createItem: async (token: string, payload: CreateItemPayload): Promise<unknown> =>
    apiRequest('/api/v1/product/items', {
      method: 'POST',
      token,
      body: {
        code: asString(payload.code).trim(),
        name: asString(payload.name).trim(),
        categoryCode: trimToNull(payload.categoryCode),
        baseUomCode: asString(payload.baseUomCode ?? payload.unitCode ?? 'kg').trim() || 'kg',
        minStockLevel: payload.minStockLevel ?? null,
        maxStockLevel: payload.maxStockLevel ?? null,
      },
    }),
  prices: async (token: string, outletId: string, on?: string): Promise<PriceView[]> =>
    decodeArrayFromPageOrArray(await apiRequest('/api/v1/product/prices', { token, query: { outletId, on } }), decodePrice),
  pricesPaged: async (token: string, query: PricesQuery): Promise<PagedResponse<PriceView>> =>
    decodePaged(await apiRequest('/api/v1/product/prices', { token, query }), decodePrice),
  upsertPrice: async (token: string, payload: UpsertPricePayload): Promise<unknown> =>
    apiRequest('/api/v1/product/prices', {
      method: 'PUT',
      token,
      body: {
        productId: toLongValue(payload.productId),
        outletId: toLongValue(payload.outletId),
        currencyCode: asString(payload.currencyCode ?? 'USD').trim() || 'USD',
        priceValue: payload.priceValue ?? payload.priceAmount ?? null,
        effectiveFrom: asDateOnly(payload.effectiveFrom),
        effectiveTo: asDateOnly(payload.effectiveTo),
      },
    }),
  recipe: async (token: string, productId: string): Promise<RecipeView> =>
    decodeRecipe(await apiRequest(`/api/v1/product/recipes/${productId}`, { token })),
  upsertRecipe: async (token: string, productId: string, payload: UpsertRecipePayload): Promise<unknown> =>
    apiRequest(`/api/v1/product/recipes/${productId}`, {
      method: 'PUT',
      token,
      body: {
        version: asString(payload.version).trim(),
        yieldQty: payload.yieldQty,
        yieldUomCode: asString(payload.yieldUomCode).trim(),
        status: trimToNull(payload.status),
        items: payload.items.map((item) => ({
          itemId: toLongValue(item.itemId),
          qty: item.qty ?? item.qtyRequired ?? null,
          uomCode: asString(item.uomCode).trim(),
        })),
      },
    }),
  updateProduct: async (
    token: string,
    productId: string,
    payload: { name?: string; categoryCode?: string; status?: string; imageUrl?: string; description?: string },
  ): Promise<ProductView> =>
    decodeProduct(
      await apiRequest(`/api/v1/product/products/${productId}`, {
        method: 'PUT',
        token,
        body: payload,
      }),
    ),
  updateItem: async (
    token: string,
    itemId: string,
    payload: { name?: string; categoryCode?: string; baseUomCode?: string; minStockLevel?: number; maxStockLevel?: number; status?: string },
  ): Promise<ItemView> =>
    decodeItem(
      await apiRequest(`/api/v1/product/items/${itemId}`, {
        method: 'PUT',
        token,
        body: payload,
      }),
    ),
  availability: async (token: string, query: { productId?: string; outletId?: string }): Promise<AvailabilityView[]> => {
    const result = await apiRequest('/api/v1/product/availability', { token, query });
    return (Array.isArray(result) ? result : []).map(decodeAvailability);
  },
  setAvailability: async (token: string, productId: string, outletId: string, available: boolean): Promise<AvailabilityView> =>
    decodeAvailability(
      await apiRequest('/api/v1/product/availability', {
        method: 'PUT',
        token,
        body: { productId: toLongValue(productId), outletId: toLongValue(outletId), available },
      }),
    ),

  // ── Categories ──────────────────────────────────────────────

  productCategories: async (token: string): Promise<CategoryView[]> => {
    const result = await apiRequest('/api/v1/product/categories', { token });
    return Array.isArray(result) ? result : [];
  },

  createProductCategory: async (
    token: string,
    payload: { code: string; name: string; description?: string },
  ): Promise<CategoryView> =>
    asRecord(await apiRequest('/api/v1/product/categories', { method: 'POST', token, body: payload })) as CategoryView,

  updateProductCategory: async (
    token: string,
    code: string,
    payload: { name?: string; description?: string; isActive?: boolean },
  ): Promise<CategoryView> =>
    asRecord(await apiRequest(`/api/v1/product/categories/${encodeURIComponent(code)}`, { method: 'PUT', token, body: payload })) as CategoryView,

  itemCategories: async (token: string): Promise<CategoryView[]> => {
    const result = await apiRequest('/api/v1/product/item-categories', { token });
    return Array.isArray(result) ? result : [];
  },

  createItemCategory: async (
    token: string,
    payload: { code: string; name: string; description?: string },
  ): Promise<CategoryView> =>
    asRecord(await apiRequest('/api/v1/product/item-categories', { method: 'POST', token, body: payload })) as CategoryView,

  // ── Menu ────────────────────────────────────────────────

  menus: async (token: string): Promise<MenuView[]> => {
    const result = await apiRequest('/api/v1/product/menus', { token });
    return Array.isArray(result) ? result : [];
  },

  menu: async (token: string, menuId: string): Promise<MenuView> =>
    asRecord(await apiRequest(`/api/v1/product/menus/${menuId}`, { token })) as unknown as MenuView,

  createMenu: async (
    token: string,
    payload: { code: string; name: string; description?: string; scopeType?: string; scopeId?: string },
  ): Promise<MenuView> =>
    asRecord(await apiRequest('/api/v1/product/menus', { method: 'POST', token, body: payload })) as unknown as MenuView,

  updateMenu: async (
    token: string,
    menuId: string,
    payload: { name?: string; description?: string; status?: string },
  ): Promise<MenuView> =>
    asRecord(await apiRequest(`/api/v1/product/menus/${menuId}`, { method: 'PUT', token, body: payload })) as unknown as MenuView,

  addMenuCategory: async (
    token: string,
    menuId: string,
    payload: { code: string; name: string; displayOrder?: number },
  ): Promise<MenuCategoryView> =>
    asRecord(await apiRequest(`/api/v1/product/menus/${menuId}/categories`, { method: 'POST', token, body: { ...payload, displayOrder: payload.displayOrder ?? 0 } })) as unknown as MenuCategoryView,

  addMenuItem: async (
    token: string,
    categoryId: string,
    payload: { productId: string; displayOrder?: number },
  ): Promise<MenuItemView> =>
    asRecord(await apiRequest(`/api/v1/product/menus/categories/${categoryId}/items`, {
      method: 'POST', token, body: { productId: toLongValue(payload.productId), displayOrder: payload.displayOrder ?? 0 },
    })) as unknown as MenuItemView,

  removeMenuItem: async (token: string, itemId: string): Promise<void> => {
    await apiRequest(`/api/v1/product/menus/items/${itemId}`, { method: 'DELETE', token });
  },

  // ── Channel & Daypart ───────────────────────────────────

  channels: async (token: string): Promise<ChannelView[]> => {
    const result = await apiRequest('/api/v1/product/channels', { token });
    return Array.isArray(result) ? result : [];
  },

  dayparts: async (token: string): Promise<DaypartView[]> => {
    const result = await apiRequest('/api/v1/product/dayparts', { token });
    return Array.isArray(result) ? result : [];
  },

  // ── Publish Center ──────────────────────────────────────

  publishVersions: async (token: string, query?: { status?: string; limit?: number; offset?: number }): Promise<PublishVersionView[]> => {
    const result = await apiRequest('/api/v1/product/publish/versions', { token, query });
    return Array.isArray(result) ? result : [];
  },

  publishVersion: async (token: string, versionId: string): Promise<PublishVersionView> =>
    asRecord(await apiRequest(`/api/v1/product/publish/versions/${versionId}`, { token })) as unknown as PublishVersionView,

  createPublishVersion: async (token: string, payload: { name: string; description?: string }): Promise<PublishVersionView> =>
    asRecord(await apiRequest('/api/v1/product/publish/versions', { method: 'POST', token, body: payload })) as unknown as PublishVersionView,

  publishItems: async (token: string, versionId: string): Promise<PublishItemView[]> => {
    const result = await apiRequest(`/api/v1/product/publish/versions/${versionId}/items`, { token });
    return Array.isArray(result) ? result : [];
  },

  addPublishItem: async (
    token: string, versionId: string,
    payload: { entityType: string; entityId: string; changeType: string; scopeType?: string; scopeId?: string; summary: string; beforeSnapshot?: string; afterSnapshot?: string },
  ): Promise<PublishItemView> =>
    asRecord(await apiRequest(`/api/v1/product/publish/versions/${versionId}/items`, {
      method: 'POST', token, body: { ...payload, entityId: toLongValue(payload.entityId) },
    })) as unknown as PublishItemView,

  removePublishItem: async (token: string, itemId: string): Promise<void> => {
    await apiRequest(`/api/v1/product/publish/items/${itemId}`, { method: 'DELETE', token });
  },

  submitForReview: async (token: string, versionId: string, note?: string): Promise<PublishVersionView> =>
    asRecord(await apiRequest(`/api/v1/product/publish/versions/${versionId}/submit`, {
      method: 'POST', token, body: { note },
    })) as unknown as PublishVersionView,

  reviewDecision: async (token: string, versionId: string, decision: string, note?: string): Promise<PublishVersionView> =>
    asRecord(await apiRequest(`/api/v1/product/publish/versions/${versionId}/review`, {
      method: 'POST', token, body: { decision, note },
    })) as unknown as PublishVersionView,

  publishVersion_publish: async (token: string, versionId: string): Promise<PublishVersionView> =>
    asRecord(await apiRequest(`/api/v1/product/publish/versions/${versionId}/publish`, {
      method: 'POST', token,
    })) as unknown as PublishVersionView,

  rollbackVersion: async (token: string, versionId: string, reason?: string): Promise<PublishVersionView> =>
    asRecord(await apiRequest(`/api/v1/product/publish/versions/${versionId}/rollback`, {
      method: 'POST', token, body: { reason },
    })) as unknown as PublishVersionView,

  // ── Audit Log ───────────────────────────────────────────

  auditLog: async (token: string, query?: { entityType?: string; entityId?: string; userId?: string; limit?: number; offset?: number }): Promise<AuditLogView[]> => {
    const result = await apiRequest('/api/v1/product/audit-log', { token, query });
    return Array.isArray(result) ? result : [];
  },
};
