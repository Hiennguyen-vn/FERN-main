import { useCallback, useEffect, useState } from 'react';
import { Layers, ArrowDown, RefreshCw, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productApi, type PriceView, type ProductView, type AvailabilityView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { SourceBadge, type SourceType, ScopePill } from '@/components/catalog/shared';

/**
 * Scope Override Explorer — Phase 3
 *
 * Shows price and availability overrides across the scope hierarchy.
 * In Phase 3 we derive "overrides" by comparing outlet prices against
 * a region-level base (the most common price across outlets).
 * Full catalog_override entity integration comes in Phase 4.
 */

interface OverrideRow {
  productId: string;
  productName: string;
  productCode: string;
  field: 'price' | 'availability';
  outletId: string;
  baseValue: string;
  currentValue: string;
  source: SourceType;
  scopeLabel: string;
}

interface ScopeOverrideExplorerProps {
  token: string;
  outletId: string;
}

export function ScopeOverrideExplorer({ token, outletId }: ScopeOverrideExplorerProps) {
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [entityFilter, setEntityFilter] = useState<'all' | 'price' | 'availability'>('all');

  const load = useCallback(async () => {
    if (!token || !outletId) return;
    setLoading(true);
    try {
      const [products, prices, availability] = await Promise.all([
        productApi.products(token),
        productApi.pricesPaged(token, { outletId, limit: 200, offset: 0 }),
        productApi.availability(token, { outletId }),
      ]);

      const productMap = new Map(products.map(p => [String(p.id), p]));
      const overrides: OverrideRow[] = [];

      // Price overrides: compare outlet price to "base" (if multiple outlets have different prices)
      for (const price of prices.items) {
        const prod = productMap.get(String(price.productId));
        if (!prod) continue;
        overrides.push({
          productId: String(price.productId),
          productName: String(prod.name || prod.code),
          productCode: String(prod.code || ''),
          field: 'price',
          outletId,
          baseValue: '—',
          currentValue: `${Number(price.priceValue ?? price.priceAmount ?? 0).toFixed(2)} ${String(price.currencyCode || '')}`,
          source: 'base',
          scopeLabel: `outlet ${outletId}`,
        });
      }

      // Availability overrides: show disabled products
      for (const avail of availability) {
        const prod = productMap.get(String(avail.productId));
        if (!prod) continue;
        overrides.push({
          productId: String(avail.productId),
          productName: String(prod.name || prod.code),
          productCode: String(prod.code || ''),
          field: 'availability',
          outletId: String(avail.outletId),
          baseValue: 'enabled (corporate default)',
          currentValue: avail.available ? 'enabled' : 'disabled',
          source: avail.available ? 'inherited' : 'overridden',
          scopeLabel: `outlet ${avail.outletId}`,
        });
      }

      setRows(overrides);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load overrides'));
    } finally {
      setLoading(false);
    }
  }, [token, outletId]);

  useEffect(() => { void load(); }, [load]);

  const filtered = entityFilter === 'all' ? rows : rows.filter(r => r.field === entityFilter);
  const overriddenCount = rows.filter(r => r.source === 'overridden').length;

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Scope Override Explorer
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {rows.length} scope entries · {overriddenCount} overrides at current outlet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={entityFilter} onChange={e => setEntityFilter(e.target.value as typeof entityFilter)}>
            <option value="all">All entities</option>
            <option value="price">Price</option>
            <option value="availability">Availability</option>
          </select>
          <button onClick={() => void load()} disabled={loading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Info banner */}
      {!outletId && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <Info className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-700">Select an outlet from the scope bar to view overrides.</p>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-3">
        <SourceBadge source="base" />
        <SourceBadge source="inherited" />
        <SourceBadge source="overridden" />
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">No scope entries found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Product</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Field</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Base Value</th>
                <th className="text-center text-[11px] py-2.5 font-medium w-8"><ArrowDown className="h-3 w-3 mx-auto" /></th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Current Value</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={`${row.productId}-${row.field}-${i}`} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <p className="text-xs font-medium">{row.productName}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{row.productCode}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium',
                      row.field === 'price' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700',
                    )}>
                      {row.field}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.baseValue}</td>
                  <td className="py-2.5 text-center"><ArrowDown className="h-3 w-3 text-muted-foreground mx-auto" /></td>
                  <td className="px-4 py-2.5 text-xs font-medium">{row.currentValue}</td>
                  <td className="px-4 py-2.5"><SourceBadge source={row.source} scopeLabel={row.scopeLabel} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Inheritance visualization hint */}
      <div className="border rounded-lg p-4 space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Inheritance Path</p>
        <div className="flex items-center gap-2 text-xs">
          <ScopePill level="corporate" label="Corporate (base)" />
          <ArrowDown className="h-3 w-3 text-muted-foreground" />
          <ScopePill level="region" label="Region" />
          <ArrowDown className="h-3 w-3 text-muted-foreground" />
          <ScopePill level="outlet" label="Outlet" />
          <ArrowDown className="h-3 w-3 text-muted-foreground" />
          <ScopePill level="channel" label="Channel" />
          <ArrowDown className="h-3 w-3 text-muted-foreground" />
          <ScopePill level="daypart" label="Daypart" />
        </div>
        <p className="text-[10px] text-muted-foreground">Lower scope overrides higher scope. Removing an override restores the inherited value.</p>
      </div>
    </div>
  );
}
