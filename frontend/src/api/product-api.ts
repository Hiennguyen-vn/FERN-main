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

export interface UpsertRecipePayload {
  items: Array<{ itemId: string | number; qtyRequired: number; uomCode: string }>;
}

function toLongValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
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
          qtyRequired: asNullableNumber(itemRecord.qtyRequired),
          uomCode: asNullableString(itemRecord.uomCode),
        };
      })
    : [];
  return {
    ...record,
    productId: asNullableString(record.productId),
    version: asNullableString(record.version),
    status: asNullableString(record.status),
    items,
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
        categoryCode: payload.categoryCode ?? null,
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
        categoryCode: payload.categoryCode ?? null,
        baseUomCode: asString(payload.baseUomCode ?? payload.unitCode ?? 'EA').trim() || 'EA',
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
    apiRequest(`/api/v1/product/recipes/${productId}`, { method: 'PUT', token, body: payload }),
};
