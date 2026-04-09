import { isApiError, toPagedResponse, type PagedResponse } from '@/api/client';
import { asArray, asRecord } from '@/api/records';

export type Decoder<T> = (value: unknown) => T;

export function decodeArray<T>(value: unknown, decodeItem: Decoder<T>): T[] {
  return asArray(value).map((item) => decodeItem(item));
}

export function decodeArrayFromPageOrArray<T>(value: unknown, decodeItem: Decoder<T>): T[] {
  if (Array.isArray(value)) {
    return value.map((item) => decodeItem(item));
  }
  const record = asRecord(value);
  if (record && Array.isArray(record.items)) {
    return record.items.map((item) => decodeItem(item));
  }
  return [];
}

export function decodePaged<T>(value: unknown, decodeItem: Decoder<T>): PagedResponse<T> {
  const page = toPagedResponse<unknown>(value);
  return {
    ...page,
    items: page.items.map((item) => decodeItem(item)),
  };
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

