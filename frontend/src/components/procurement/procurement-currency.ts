import type { ScopeOutlet, ScopeRegion } from '@/api/org-api';
import { normalizeCurrencyCode, resolveScopeCurrencyCode } from '@/lib/org-currency';

export function resolveProcurementScopeCurrency({
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
  return resolveScopeCurrencyCode({
    regions,
    outlets,
    regionId,
    outletId,
    fallback,
  });
}

export function resolveGoodsReceiptCurrency({
  purchaseOrderCurrencyCode,
  scopeCurrencyCode,
  fallback = 'USD',
}: {
  purchaseOrderCurrencyCode?: string | null;
  scopeCurrencyCode?: string | null;
  fallback?: string;
}) {
  return normalizeCurrencyCode(
    purchaseOrderCurrencyCode,
    normalizeCurrencyCode(scopeCurrencyCode, fallback),
  );
}
