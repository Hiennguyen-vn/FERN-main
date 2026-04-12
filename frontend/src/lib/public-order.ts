import { ApiError, isApiError } from '@/api/client';
import type { CreatePublicOrderPayload, PublicMenuItemView } from '@/api/sales-api';

export interface PublicOrderCartLine {
  productId: string;
  quantity: number;
  note: string;
}

export interface PublicOrderCartDraft {
  note: string;
  items: PublicOrderCartLine[];
}

export interface PublicOrderCategory {
  code: string;
  label: string;
  items: PublicMenuItemView[];
}

export interface PublicOrderCartSummary {
  itemCount: number;
  subtotal: number;
  invalidProductIds: string[];
}

export const PUBLIC_ORDER_POLL_INTERVAL_MS = 15_000;

export function publicOrderCartStorageKey(tableToken: string) {
  return `public-order-cart:${String(tableToken || '')}`;
}

export function publicOrderLastOrderStorageKey(tableToken: string) {
  return `public-order-last-order:${String(tableToken || '')}`;
}

export function createEmptyPublicOrderCartDraft(): PublicOrderCartDraft {
  return {
    note: '',
    items: [],
  };
}

function sanitizeCartLine(value: unknown): PublicOrderCartLine | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const productId = String(record.productId ?? '').trim();
  const quantity = Number(record.quantity ?? 0);
  if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const note = record.note == null ? '' : String(record.note).trim();
  return {
    productId,
    quantity,
    note,
  };
}

export function sanitizePublicOrderCartDraft(value: unknown): PublicOrderCartDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyPublicOrderCartDraft();
  }
  const record = value as Record<string, unknown>;
  return {
    note: record.note == null ? '' : String(record.note).trim(),
    items: Array.isArray(record.items) ? record.items.map(sanitizeCartLine).filter((item): item is PublicOrderCartLine => item !== null) : [],
  };
}

export function groupPublicMenuByCategory(menu: PublicMenuItemView[]): PublicOrderCategory[] {
  const groups = new Map<string, PublicMenuItemView[]>();
  for (const item of menu) {
    const code = String(item.categoryCode || 'menu').trim() || 'menu';
    const current = groups.get(code);
    if (current) {
      current.push(item);
    } else {
      groups.set(code, [item]);
    }
  }
  return Array.from(groups.entries()).map(([code, items]) => ({
    code,
    label: formatPublicLabel(code),
    items,
  }));
}

export function computePublicOrderCartSummary(
  draft: PublicOrderCartDraft,
  menuByProductId: ReadonlyMap<string, PublicMenuItemView>,
): PublicOrderCartSummary {
  let itemCount = 0;
  let subtotal = 0;
  const invalidProductIds = new Set<string>();
  for (const item of draft.items) {
    const quantity = Number(item.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    itemCount += quantity;
    const menuItem = menuByProductId.get(item.productId);
    if (!menuItem) {
      invalidProductIds.add(item.productId);
      continue;
    }
    subtotal += quantity * Number(menuItem.priceValue || 0);
  }
  return {
    itemCount,
    subtotal,
    invalidProductIds: Array.from(invalidProductIds),
  };
}

export function toCreatePublicOrderPayload(draft: PublicOrderCartDraft): CreatePublicOrderPayload {
  return {
    note: draft.note.trim() || null,
    items: draft.items
      .filter((item) => Number(item.quantity || 0) > 0)
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        note: item.note.trim() || null,
      })),
  };
}

export function formatPublicLabel(value: string | null | undefined, fallback = 'Unknown') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function shortPublicOrderRef(orderToken: string | null | undefined) {
  const token = String(orderToken || '').trim();
  if (!token) return '—';
  return token.length <= 10 ? token : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function isPublicOrderUnavailableError(error: unknown) {
  return isApiError(error) && error.status === 409;
}

export function isPublicOrderNotFoundError(error: unknown) {
  return isApiError(error) && error.status === 404;
}

export function toPublicOrderErrorMessage(error: unknown, fallback: string) {
  if (!isApiError(error)) {
    return fallback;
  }
  return error.message || fallback;
}

export function asPublicApiError(error: unknown): ApiError | null {
  return isApiError(error) ? error : null;
}
