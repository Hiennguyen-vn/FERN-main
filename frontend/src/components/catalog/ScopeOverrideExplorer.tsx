import { useCallback, useEffect, useState } from 'react';
import { Layers, ArrowDown, ArrowRight, RefreshCw, Loader2, Info, AlertTriangle, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productApi, orgApi, type PriceView, type AvailabilityView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { SourceBadge, type SourceType, ScopePill } from '@/components/catalog/shared';

interface OrgOutlet { id: string; code: string; name: string; regionId: string; }
interface OrgRegion { id: string; code: string; name: string; currencyCode: string; }

interface OverrideRow {
  productId: string;
  productName: string;
  outletId: string;
  outletCode: string;
  outletName: string;
  regionName: string;
  field: 'price' | 'availability';
  value: string;
  source: SourceType;
}

interface ScopeOverrideExplorerProps {
  token: string;
  outletId: string;
}

export function ScopeOverrideExplorer({ token, outletId }: ScopeOverrideExplorerProps) {
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [entityFilter, setEntityFilter] = useState<'all' | 'price' | 'availability'>('all');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(false);
    try {
      // Load org hierarchy for outlet/region names
      const hierarchy = await orgApi.hierarchy(token);
      const outletMap = new Map<string, OrgOutlet>();
      const regionMap = new Map<string, OrgRegion>();
      for (const r of hierarchy.regions) {
        regionMap.set(String(r.id), { id: String(r.id), code: String(r.code || ''), name: String(r.name || ''), currencyCode: String(r.currencyCode || '') });
      }
      for (const o of hierarchy.outlets) {
        outletMap.set(String(o.id), { id: String(o.id), code: String(o.code || ''), name: String(o.name || ''), regionId: String(o.regionId || '') });
      }

      const resolveOutlet = (oid: string) => outletMap.get(oid);
      const resolveRegion = (rid: string) => regionMap.get(rid);

      // Load all products for name resolution
      const products = await productApi.products(token);
      const prodMap = new Map(products.map(p => [String(p.id), p]));

      const overrides: OverrideRow[] = [];

      // Load prices across visible outlets
      const targetOutlets = outletId
        ? [outletMap.get(outletId)].filter((o): o is OrgOutlet => !!o)
        : Array.from(outletMap.values());

      for (const outlet of targetOutlets.slice(0, 30)) {
        try {
          const prices = await productApi.pricesPaged(token, { outletId: outlet.id, limit: 100, offset: 0 });
          for (const price of prices.items) {
            const prod = prodMap.get(String(price.productId));
            const region = resolveRegion(outlet.regionId);
            overrides.push({
              productId: String(price.productId),
              productName: prod ? String(prod.name || prod.code) : String(price.productId),
              outletId: outlet.id,
              outletCode: outlet.code,
              outletName: outlet.name,
              regionName: region?.name || '',
              field: 'price',
              value: `${Number(price.priceValue ?? price.priceAmount ?? 0).toLocaleString()} ${price.currencyCode || ''}`,
              source: 'base',
            });
          }
        } catch { /* skip */ }
      }

      // Load availability
      try {
        const availability = outletId
          ? await productApi.availability(token, { outletId })
          : await productApi.availability(token, {});

        for (const avail of availability) {
          const oid = String(avail.outletId);
          const outlet = resolveOutlet(oid);
          if (!outlet) continue;
          const prod = prodMap.get(String(avail.productId));
          const region = resolveRegion(outlet.regionId);
          if (!avail.available) {
            overrides.push({
              productId: String(avail.productId),
              productName: prod ? String(prod.name || prod.code) : String(avail.productId),
              outletId: oid,
              outletCode: outlet.code,
              outletName: outlet.name,
              regionName: region?.name || '',
              field: 'availability',
              value: 'disabled',
              source: 'overridden',
            });
          }
        }
      } catch { /* skip */ }

      setRows(overrides);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load overrides'));
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token, outletId]);

  useEffect(() => { void load(); }, [load]);

  const filtered = entityFilter === 'all' ? rows : rows.filter(r => r.field === entityFilter);
  const priceCount = rows.filter(r => r.field === 'price').length;
  const overriddenCount = rows.filter(r => r.source === 'overridden').length;
  const outletCount = new Set(rows.map(r => r.outletId)).size;

  return (
    <div className="p-4 sm:p-6 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Scope Override Explorer
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {priceCount} prices · {overriddenCount} overrides · {outletCount} outlets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={entityFilter} onChange={e => setEntityFilter(e.target.value as typeof entityFilter)}>
            <option value="all">All ({rows.length})</option>
            <option value="price">Prices ({priceCount})</option>
            <option value="availability">Availability overrides ({overriddenCount})</option>
          </select>
          <button onClick={() => void load()} disabled={loading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source="base" />
        <SourceBadge source="inherited" />
        <SourceBadge source="overridden" />
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="surface-elevated p-6 text-center space-y-2">
          <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
          <p className="text-sm text-muted-foreground">Failed to load override data</p>
          <button onClick={() => void load()} className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[10px] font-medium">Retry</button>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="surface-elevated overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <Layers className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No scope entries found</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {outletId ? 'No prices or availability overrides at this outlet.' : 'Set prices or toggle availability for products to see data here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5 font-medium">Product</th>
                    <th className="text-left text-[11px] px-4 py-2.5 font-medium">Outlet</th>
                    <th className="text-left text-[11px] px-4 py-2.5 font-medium">Type</th>
                    <th className="text-left text-[11px] px-4 py-2.5 font-medium">Value</th>
                    <th className="text-left text-[11px] px-4 py-2.5 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => (
                    <tr key={`${row.productId}-${row.outletId}-${row.field}-${i}`} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <p className="text-xs font-medium">{row.productName}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-xs">{row.outletCode}</p>
                        <p className="text-[10px] text-muted-foreground">{row.outletName}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          'inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium',
                          row.field === 'price' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
                        )}>
                          {row.field}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium font-mono">{row.value}</td>
                      <td className="px-4 py-2.5"><SourceBadge source={row.source} scopeLabel={row.regionName || 'outlet'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Inheritance visualization */}
      <div className="border rounded-lg p-4 space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Inheritance Path</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <ScopePill level="corporate" label="Corporate (base)" />
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <ScopePill level="region" label="Region" />
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <ScopePill level="outlet" label="Outlet" />
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <ScopePill level="channel" label="Channel" />
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <ScopePill level="daypart" label="Daypart" />
        </div>
        <p className="text-[10px] text-muted-foreground">Lower scope overrides higher scope. Removing an override restores the inherited value.</p>
      </div>
    </div>
  );
}
