import type { ScopeOutlet, ScopeRegion } from '@/api/org-api';

export function normalizeCurrencyCode(value?: string | null, fallback = 'USD') {
  const code = String(value ?? '').trim().toUpperCase();
  return code || fallback;
}

export function resolveScopeCurrencyCode({
  regions,
  outlets,
  regionId,
  outletId,
  fallback = 'USD',
}: {
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
  regionId?: string;
  outletId?: string;
  fallback?: string;
}) {
  const normalizedRegionId = String(regionId ?? '').trim();
  const normalizedOutletId = String(outletId ?? '').trim();

  if (normalizedOutletId) {
    const outlet = outlets.find((candidate) => candidate.id === normalizedOutletId);
    const outletRegion = outlet ? regions.find((candidate) => candidate.id === outlet.regionId) : undefined;
    return normalizeCurrencyCode(outletRegion?.currencyCode, fallback);
  }

  if (normalizedRegionId) {
    const region = regions.find((candidate) => candidate.id === normalizedRegionId);
    return normalizeCurrencyCode(region?.currencyCode, fallback);
  }

  return normalizeCurrencyCode(undefined, fallback);
}
