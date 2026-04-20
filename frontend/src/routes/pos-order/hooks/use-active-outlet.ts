import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/use-auth';
import { orgApi, type ScopeOutlet, type ScopeRegion } from '@/api/org-api';
import { resolveRolesForOutlet } from './use-role-for-outlet';

const STORAGE_KEY = 'fern.posorder.outletId';

export interface ActiveOutletState {
  outletId: string | null;
  outletName: string;
  currencyCode: string;
  outlets: ScopeOutlet[];
  regions: ScopeRegion[];
  isValid: boolean;
  isLoading: boolean;
  errorMessage?: string;
  setOutletId: (id: string) => void;
}

export function useActiveOutlet(): ActiveOutletState {
  const { session } = useAuth();
  const token = session?.accessToken;
  const [searchParams, setSearchParams] = useSearchParams();
  const [manualOutletId, setManualOutletId] = useState<string | null>(null);

  const hierarchyQuery = useQuery({
    queryKey: ['pos-order-hierarchy', token],
    queryFn: () => orgApi.hierarchy(token!),
    enabled: !!token,
    staleTime: 60_000,
  });

  const accessibleOutlets = useMemo(() => {
    if (!hierarchyQuery.data) return [];
    return hierarchyQuery.data.outlets.filter((o) => {
      const r = resolveRolesForOutlet(session, o.id);
      return r.canSell;
    });
  }, [hierarchyQuery.data, session]);

  const queryOutletId = searchParams.get('outlet');

  const storedOutletId = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
  const candidateIds = [manualOutletId, queryOutletId, storedOutletId].filter(Boolean) as string[];
  const firstAccessibleId = accessibleOutlets[0]?.id ?? null;

  let outletId: string | null = null;
  for (const id of candidateIds) {
    if (accessibleOutlets.some((o) => o.id === id)) {
      outletId = id;
      break;
    }
  }
  if (!outletId && firstAccessibleId) outletId = firstAccessibleId;

  const outlet = outletId ? accessibleOutlets.find((o) => o.id === outletId) ?? null : null;
  const region = outlet ? hierarchyQuery.data?.regions.find((r) => r.id === outlet.regionId) ?? null : null;

  const paramId = queryOutletId;
  const paramValid = paramId ? accessibleOutlets.some((o) => o.id === paramId) : true;

  useEffect(() => {
    if (!outletId) return;
    try { window.localStorage.setItem(STORAGE_KEY, outletId); } catch { /* ignore */ }
  }, [outletId]);

  useEffect(() => {
    if (!outletId) return;
    if (queryOutletId === outletId) return;
    const next = new URLSearchParams(searchParams);
    next.set('outlet', outletId);
    setSearchParams(next, { replace: true });
  }, [outletId, queryOutletId, searchParams, setSearchParams]);

  const setOutletId = (id: string) => setManualOutletId(id);

  const resolvedCurrency = (region?.currencyCode ?? '').trim();
  const outletCurrency = (outlet?.currencyCode as string | undefined)?.trim();
  const currencyCode = resolvedCurrency || outletCurrency || '';

  const errorMessage = !paramValid
    ? 'Bạn không có quyền truy cập outlet này.'
    : accessibleOutlets.length === 0 && !hierarchyQuery.isLoading
      ? 'Tài khoản chưa được gán outlet nào để bán hàng.'
      : !!outlet && !currencyCode
        ? 'Outlet chưa cấu hình đơn vị tiền tệ. Liên hệ admin để bổ sung region.'
        : undefined;

  return {
    outletId,
    outletName: outlet?.name ?? outlet?.code ?? '',
    currencyCode,
    outlets: accessibleOutlets,
    regions: hierarchyQuery.data?.regions ?? [],
    isValid: !errorMessage && !!outletId && !!currencyCode,
    isLoading: hierarchyQuery.isLoading,
    errorMessage,
    setOutletId,
  };
}
