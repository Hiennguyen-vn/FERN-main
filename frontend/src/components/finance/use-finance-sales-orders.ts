import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  salesApi,
  type SaleListItemView,
  type SalesOrdersQuery,
  type ScopeOutlet,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';
import { getFinanceVisibleOutlets } from '@/components/finance/finance-phase2-utils';

interface Params {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  outlets: ScopeOutlet[];
}

export function useFinanceSalesOrders({
  token,
  scopeRegionId,
  scopeOutletId,
  outlets,
}: Params) {
  const visibleOutlets = useMemo(
    () => getFinanceVisibleOutlets(outlets, scopeRegionId, scopeOutletId),
    [outlets, scopeOutletId, scopeRegionId],
  );
  const [orders, setOrders] = useState<SaleListItemView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const items = await collectPagedItems<SaleListItemView, SalesOrdersQuery>(
        (query) => salesApi.orders(token, query),
        {
          outletId: scopeOutletId || undefined,
          sortBy: 'createdAt',
          sortDir: 'desc',
        },
        200,
        25,
      );

      const visibleOutletIds = new Set(visibleOutlets.map((outlet) => outlet.id));
      setOrders(
        visibleOutletIds.size > 0
          ? items.filter((order) => visibleOutletIds.has(String(order.outletId ?? '')))
          : items,
      );
    } catch (err: unknown) {
      console.error('Finance sales orders load failed', err);
      setOrders([]);
      setError(getErrorMessage(err, 'Unable to load sales orders'));
    } finally {
      setLoading(false);
    }
  }, [scopeOutletId, token, visibleOutlets]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    orders,
    visibleOutlets,
    loading,
    error,
    refresh: load,
  };
}
