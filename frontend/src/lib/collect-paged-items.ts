import type { PagedResponse } from '@/api/client';

type PagedQuery = {
  limit?: number;
  offset?: number;
};

export async function collectPagedItems<T, Q extends PagedQuery = PagedQuery>(
  loadPage: (query: Q) => Promise<PagedResponse<T>>,
  query: Omit<Q, 'limit' | 'offset'> & Partial<PagedQuery>,
  pageSize = 100,
  maxPages = 100,
): Promise<T[]> {
  const items: T[] = [];

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const offset = pageIndex * pageSize;
    const page = await loadPage({
      ...(query as object),
      limit: pageSize,
      offset,
    } as Q);

    const batch = page.items || [];
    items.push(...batch);

    const total = page.total ?? page.totalCount;
    if (batch.length === 0) {
      break;
    }
    if (typeof total === 'number' && items.length >= total) {
      break;
    }
    if (!(page.hasMore || page.hasNextPage) && batch.length < pageSize) {
      break;
    }
    if (!(page.hasMore || page.hasNextPage) && typeof total !== 'number') {
      break;
    }
  }

  return items;
}
