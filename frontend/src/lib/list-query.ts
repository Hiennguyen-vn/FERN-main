export type SortDir = 'asc' | 'desc';

export const DEFAULT_LIST_LIMIT = 20;
export const DEFAULT_LIST_LIMIT_OPTIONS = [10, 20, 50, 100] as const;

export interface ListQueryParams<TFilters extends Record<string, unknown> = Record<string, unknown>> {
  limit: number;
  offset: number;
  sortBy?: string;
  sortDir?: SortDir;
  q?: string;
  filters?: TFilters;
}

export function toPage(offset: number, limit: number) {
  const safeLimit = Math.max(1, Number(limit) || DEFAULT_LIST_LIMIT);
  const safeOffset = Math.max(0, Number(offset) || 0);
  return Math.floor(safeOffset / safeLimit) + 1;
}

export function toOffset(page: number, limit: number) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Number(limit) || DEFAULT_LIST_LIMIT);
  return (safePage - 1) * safeLimit;
}

function compactValue(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return value;
}

export function compactQuery(input: Record<string, unknown>) {
  const next: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(input)) {
    const value = compactValue(raw);
    if (value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value;
    }
  }
  return next;
}

export function buildListQuery<TFilters extends Record<string, unknown> = Record<string, unknown>>(
  params: ListQueryParams<TFilters>,
) {
  const { limit, offset, sortBy, sortDir, q, filters } = params;
  return compactQuery({
    limit,
    offset,
    sortBy,
    sortDir,
    q,
    ...(filters || {}),
  });
}
