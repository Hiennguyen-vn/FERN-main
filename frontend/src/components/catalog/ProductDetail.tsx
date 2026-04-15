import { useEffect, useState } from 'react';
import {
  Package, Store, MapPin, Check, X, Loader2, DollarSign, BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { productApi, type ProductView, type PriceView, type RecipeView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';

type DetailTab = 'info' | 'availability' | 'pricing' | 'recipe';

interface OutletAvailability {
  outletId: string;
  outletCode: string;
  outletName: string;
  regionName: string;
  available: boolean;
  price?: number;
  currency?: string;
}

interface ProductDetailProps {
  product: ProductView;
  token: string;
  outlets: { id: string; code: string; name: string; regionName: string }[];
  onClose: () => void;
}

export function ProductDetail({ product, token, outlets, onClose }: ProductDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('info');
  const [prices, setPrices] = useState<PriceView[]>([]);
  const [recipe, setRecipe] = useState<RecipeView | null>(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [recipeLoading, setRecipeLoading] = useState(false);

  const productId = String(product.id);
  const productName = String(product.name || product.code || product.id);

  // Load prices for all outlets when pricing tab selected
  useEffect(() => {
    if (activeTab !== 'pricing' && activeTab !== 'availability') return;
    if (!token || pricesLoading) return;
    let cancelled = false;
    setPricesLoading(true);
    productApi
      .prices(token, { limit: 200 })
      .then((result) => {
        if (cancelled) return;
        const allPrices = Array.isArray(result) ? result : result?.items || [];
        setPrices(allPrices.filter((p: PriceView) => String(p.productId) === productId));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPricesLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, productId, token]);

  // Load recipe
  useEffect(() => {
    if (activeTab !== 'recipe') return;
    if (!token || recipeLoading) return;
    let cancelled = false;
    setRecipeLoading(true);
    productApi
      .recipe(token, productId)
      .then((r) => { if (!cancelled) setRecipe(r); })
      .catch(() => { if (!cancelled) setRecipe(null); })
      .finally(() => { if (!cancelled) setRecipeLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, productId, token]);

  // Build availability matrix
  const availability: OutletAvailability[] = outlets.map((outlet) => {
    const price = prices.find((p) => String(p.outletId) === outlet.id);
    return {
      outletId: outlet.id,
      outletCode: outlet.code,
      outletName: outlet.name,
      regionName: outlet.regionName,
      available: !!price,
      price: price ? Number(price.priceValue ?? price.priceAmount ?? 0) : undefined,
      currency: price ? String(price.currencyCode || '') : undefined,
    };
  });

  const availableCount = availability.filter((a) => a.available).length;

  const TABS: { key: DetailTab; label: string; icon: React.ElementType }[] = [
    { key: 'info', label: 'Details', icon: Package },
    { key: 'availability', label: `Outlets (${availableCount}/${outlets.length})`, icon: Store },
    { key: 'pricing', label: 'Pricing', icon: DollarSign },
    { key: 'recipe', label: 'Recipe', icon: BookOpen },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">{productName}</h3>
              <p className="text-[11px] text-muted-foreground font-mono">{String(product.code || product.id)}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={cn(
              'inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              product.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
            )}
          >
            {String(product.status || 'draft')}
          </span>
          <button onClick={onClose} className="h-7 w-7 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b px-5 flex items-center gap-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'info' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Code</p>
                <p className="text-sm font-mono mt-1">{String(product.code || '—')}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Category</p>
                <p className="text-sm mt-1">{String(product.categoryCode || '—')}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</p>
                <p className="text-sm mt-1">{String(product.status || '—')}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Outlet Coverage</p>
                <p className="text-sm mt-1">{availableCount} of {outlets.length} outlets</p>
              </div>
            </div>
            {product.description && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Description</p>
                <p className="text-sm mt-1 text-muted-foreground">{String(product.description)}</p>
              </div>
            )}

            {/* Quick availability summary */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Outlet Availability</p>
              <div className="flex flex-wrap gap-1.5">
                {availability.map((a) => (
                  <span
                    key={a.outletId}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium',
                      a.available
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-muted text-muted-foreground border border-border',
                    )}
                    title={`${a.outletName} — ${a.regionName}`}
                  >
                    {a.available ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                    {a.outletCode}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'availability' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Shows which outlets currently have this product priced and available for sale.
            </p>
            {pricesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Outlet</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Region</th>
                      <th className="text-center text-[11px] px-4 py-2.5">Available</th>
                      <th className="text-right text-[11px] px-4 py-2.5">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availability.map((a) => (
                      <tr key={a.outletId} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Store className="h-3.5 w-3.5 text-muted-foreground" />
                            <div>
                              <p className="text-xs font-medium">{a.outletName}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{a.outletCode}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {a.regionName}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {a.available ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                              <Check className="h-3 w-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                              <X className="h-3 w-3" /> Not listed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">
                          {a.price != null ? `${a.currency} ${a.price.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Pricing rules for {productName} across all outlets in your scope.
            </p>
            {pricesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : prices.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No pricing configured yet</div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Outlet</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Currency</th>
                      <th className="text-right text-[11px] px-4 py-2.5">Price</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Effective From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prices.map((p, i) => {
                      const outlet = outlets.find((o) => o.id === String(p.outletId));
                      return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-xs">{outlet?.name || String(p.outletId)}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(p.currencyCode || '—')}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">{Number(p.priceValue ?? p.priceAmount ?? 0).toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(p.effectiveFrom || '—')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'recipe' && (
          <div className="space-y-3">
            {recipeLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !recipe ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No recipe configured for this product</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Version</p>
                    <p className="text-sm mt-1">{String(recipe.version || '—')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Yield</p>
                    <p className="text-sm mt-1">{recipe.yieldQty} {recipe.yieldUomCode}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</p>
                    <span className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase mt-1',
                      recipe.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                    )}>
                      {String(recipe.status || 'draft')}
                    </span>
                  </div>
                </div>
                {recipe.items && recipe.items.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left text-[11px] px-4 py-2.5">Ingredient</th>
                          <th className="text-right text-[11px] px-4 py-2.5">Qty</th>
                          <th className="text-left text-[11px] px-4 py-2.5">UOM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipe.items.map((line, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-4 py-2.5 text-xs font-mono">{String(line.itemId || '—')}</td>
                            <td className="px-4 py-2.5 text-right text-xs">{Number(line.qtyRequired || 0).toFixed(3)}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(line.uomCode || '—')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
