import JSONbig from 'json-bigint';
import { isCookieBackedSessionToken } from '@/auth/session';

const jsonParser = JSONbig({ storeAsString: true, useNativeBigInt: false });

type JsonRecord = Record<string, unknown>;

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  query?: object;
  signal?: AbortSignal;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';

function toQueryString(query?: RequestOptions['query']) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

async function parseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return jsonParser.parse(text);
  } catch {
    return text;
  }
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', token, body, query, signal } = options;
  const queryString = toQueryString(query);
  const url = `${API_BASE}${path}${queryString}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token && !isCookieBackedSessionToken(token)) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    signal,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const parsed = await parseBody(response);
  const errorRecord = asRecord(parsed);

  if (!response.ok) {
    const message =
      (typeof errorRecord?.message === 'string' ? errorRecord.message : null) ||
      (typeof errorRecord?.error === 'string' ? errorRecord.error : null) ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, parsed);
  }

  return parsed as T;
}

export function asId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export interface PagedResponse<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  totalCount: number;
  hasMore: boolean;
  hasNextPage: boolean;
}

export function toPagedResponse<T>(input: unknown): PagedResponse<T> {
  if (Array.isArray(input)) {
    return {
      items: input as T[],
      limit: input.length,
      offset: 0,
      total: input.length,
      totalCount: input.length,
      hasMore: false,
      hasNextPage: false,
    };
  }

  const record = asRecord(input);
  if (!record) {
    throw new TypeError('Expected paged response object or array');
  }

  if (
    record.items === undefined
    && record.limit === undefined
    && record.offset === undefined
    && record.total === undefined
    && record.totalCount === undefined
    && record.hasMore === undefined
    && record.hasNextPage === undefined
  ) {
    throw new TypeError('Expected paged response shape with pagination metadata');
  }

  const items = Array.isArray(record.items) ? (record.items as T[]) : [];
  const limit = Number(record.limit ?? items.length ?? 0);
  const offset = Number(record.offset ?? 0);
  const total = Number(record.total ?? record.totalCount ?? items.length ?? 0);
  const hasMore = Boolean(
    record.hasMore ??
      record.hasNextPage ??
      (Number.isFinite(total) && Number.isFinite(limit) ? offset + limit < total : false),
  );

  return {
    items,
    limit,
    offset,
    total,
    totalCount: total,
    hasMore,
    hasNextPage: hasMore,
  };
}
