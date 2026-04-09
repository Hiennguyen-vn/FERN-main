import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildListQuery,
  DEFAULT_LIST_LIMIT,
  toOffset,
  toPage,
  type SortDir,
} from '@/lib/list-query';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

interface UseListQueryStateOptions<TFilters extends Record<string, unknown>> {
  initialLimit?: number;
  initialSortBy?: string;
  initialSortDir?: SortDir;
  initialSearch?: string;
  initialFilters?: TFilters;
  debounceMs?: number;
}

export function useListQueryState<TFilters extends Record<string, unknown> = Record<string, unknown>>(
  options: UseListQueryStateOptions<TFilters> = {},
) {
  const {
    initialLimit = DEFAULT_LIST_LIMIT,
    initialSortBy,
    initialSortDir = 'desc',
    initialSearch = '',
    initialFilters = {} as TFilters,
    debounceMs = 350,
  } = options;

  const [limit, setLimit] = useState(Math.max(1, Number(initialLimit) || DEFAULT_LIST_LIMIT));
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<string | undefined>(initialSortBy);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [filters, setFilters] = useState<TFilters>(initialFilters);

  const debouncedSearch = useDebouncedValue(searchInput.trim(), debounceMs);
  const q = debouncedSearch || undefined;

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    setOffset(0);
  }, [q, sortBy, sortDir, filterKey]);

  const query = useMemo(() => {
    return buildListQuery({
      limit,
      offset,
      sortBy,
      sortDir,
      q,
      filters,
    });
  }, [limit, offset, sortBy, sortDir, q, filters]);

  const requestKey = useMemo(() => JSON.stringify(query), [query]);

  const page = useMemo(() => toPage(offset, limit), [offset, limit]);

  const setPage = useCallback((nextPage: number) => {
    setOffset(toOffset(nextPage, limit));
  }, [limit]);

  const setPageSize = useCallback((nextLimit: number) => {
    const safeLimit = Math.max(1, Number(nextLimit) || DEFAULT_LIST_LIMIT);
    setLimit(safeLimit);
    setOffset(0);
  }, []);

  const setSort = useCallback((field: string) => {
    if (!field) return;
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  const applySort = useCallback((field: string, direction: SortDir) => {
    if (!field) return;
    setSortBy(field);
    setSortDir(direction);
  }, []);

  const setFilter = useCallback(<K extends keyof TFilters>(key: K, value: TFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const patchFilters = useCallback((patch: Partial<TFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback((nextFilters?: TFilters) => {
    setFilters(nextFilters ?? ({} as TFilters));
  }, []);

  return {
    query,
    requestKey,
    limit,
    offset,
    page,
    sortBy,
    sortDir,
    searchInput,
    debouncedSearch,
    isDebouncing: searchInput.trim() !== (q ?? ''),
    filters,
    setSearchInput,
    setPage,
    setPageSize,
    setSort,
    applySort,
    setFilter,
    patchFilters,
    resetFilters,
    setOffset,
  };
}
