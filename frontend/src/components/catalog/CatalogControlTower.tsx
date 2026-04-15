import { useCallback, useEffect, useState } from 'react';
import {
  Package, Leaf, BookOpen, DollarSign, Store, AlertTriangle, ArrowRight,
  CheckCircle2, Loader2, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { productApi } from '@/api/fern-api';
import type { ProductView, ItemView } from '@/api/fern-api';

interface ControlTowerProps {
  token: string;
  outletId: string;
  onNavigate: (tab: string) => void;
}

interface CatalogMetrics {
  totalProducts: number;
  activeProducts: number;
  draftProducts: number;
  totalIngredients: number;
  recipeCoverage: number;
  pricedAtOutlet: number;
  availableOutlets: number;
  loading: boolean;
}

export function CatalogControlTower({ token, outletId, onNavigate }: ControlTowerProps) {
  const [metrics, setMetrics] = useState<CatalogMetrics>({
    totalProducts: 0, activeProducts: 0, draftProducts: 0,
    totalIngredients: 0, recipeCoverage: 0, pricedAtOutlet: 0,
    availableOutlets: 0, loading: true,
  });

  const load = useCallback(async () => {
    if (!token) return;
    setMetrics(m => ({ ...m, loading: true }));
    try {
      const [products, items] = await Promise.all([
        productApi.productsPaged(token, { limit: 1, offset: 0 }),
        productApi.itemsPaged(token, { limit: 1, offset: 0 }),
      ]);

      let pricedCount = 0;
      if (outletId) {
        const prices = await productApi.pricesPaged(token, { outletId, limit: 1, offset: 0 }).catch(() => ({ totalCount: 0 }));
        pricedCount = prices.totalCount;
      }

      // Count recipes by loading first page of products and checking each
      let recipeCount = 0;
      const prodPage = await productApi.productsPaged(token, { limit: 50, offset: 0 });
      const checks = await Promise.all(
        prodPage.items.map(p =>
          productApi.recipe(token, String(p.id)).then(() => true).catch(() => false)
        )
      );
      recipeCount = checks.filter(Boolean).length;

      const activeCount = prodPage.items.filter(p => p.status === 'active').length;
      const draftCount = prodPage.items.filter(p => p.status === 'draft').length;

      setMetrics({
        totalProducts: products.totalCount,
        activeProducts: activeCount,
        draftProducts: draftCount,
        totalIngredients: items.totalCount,
        recipeCoverage: products.totalCount > 0 ? Math.round((recipeCount / Math.min(products.totalCount, 50)) * 100) : 0,
        pricedAtOutlet: pricedCount,
        availableOutlets: 0,
        loading: false,
      });
    } catch {
      setMetrics(m => ({ ...m, loading: false }));
    }
  }, [token, outletId]);

  useEffect(() => { void load(); }, [load]);

  const kpis = [
    { label: 'Products', value: metrics.totalProducts, sub: `${metrics.activeProducts} active, ${metrics.draftProducts} draft`, icon: Package, color: 'text-foreground' },
    { label: 'Ingredients', value: metrics.totalIngredients, sub: 'tracked items', icon: Leaf, color: 'text-foreground' },
    { label: 'Recipe Coverage', value: `${metrics.recipeCoverage}%`, sub: 'of products', icon: BookOpen, color: metrics.recipeCoverage < 80 ? 'text-amber-600' : 'text-foreground' },
    { label: 'Priced (outlet)', value: metrics.pricedAtOutlet, sub: outletId ? 'at current outlet' : 'select outlet', icon: DollarSign, color: 'text-foreground' },
  ];

  const alerts: { severity: 'warning' | 'info'; label: string; tab: string }[] = [];
  if (metrics.draftProducts > 0) {
    alerts.push({ severity: 'warning', label: `${metrics.draftProducts} products still in draft`, tab: 'products' });
  }
  if (metrics.recipeCoverage < 100 && metrics.totalProducts > 0) {
    alerts.push({ severity: 'info', label: `${100 - metrics.recipeCoverage}% products missing recipes`, tab: 'recipes' });
  }
  if (outletId && metrics.pricedAtOutlet === 0 && metrics.totalProducts > 0) {
    alerts.push({ severity: 'warning', label: 'No products priced at current outlet', tab: 'pricing' });
  }

  const navTiles = [
    { tab: 'products', label: 'Product Master', desc: 'Create and manage sellable products', icon: Package, stat: `${metrics.totalProducts} products` },
    { tab: 'ingredients', label: 'Ingredient Library', desc: 'Raw materials, UOM, stock thresholds', icon: Leaf, stat: `${metrics.totalIngredients} items` },
    { tab: 'recipes', label: 'Recipe Studio', desc: 'Composition, versioning, cost roll-up', icon: BookOpen, stat: `${metrics.recipeCoverage}% coverage` },
    { tab: 'pricing', label: 'Price Rules', desc: 'Outlet pricing, promotions, effective dates', icon: DollarSign, stat: `${metrics.pricedAtOutlet} priced` },
  ];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Catalog Control Tower</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Overview of catalog health and completeness across the chain</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(kpi => (
          <div key={kpi.label} className="surface-elevated p-4">
            {metrics.loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="flex items-center gap-1.5 mb-2">
                  <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
                </div>
                <p className={cn('text-xl font-semibold', kpi.color)}>{kpi.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.sub}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-2.5 border-b flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Attention Required</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{alerts.length} item{alerts.length > 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y">
            {alerts.map((alert, i) => (
              <button key={i} onClick={() => onNavigate(alert.tab)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors text-left group">
                {alert.severity === 'warning' ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                ) : (
                  <TrendingUp className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                )}
                <span className="text-sm text-foreground flex-1">{alert.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Nav tiles */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Modules</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {navTiles.map(tile => (
            <button key={tile.tab} onClick={() => onNavigate(tile.tab)}
              className="surface-elevated p-4 flex flex-col gap-3 group hover:border-primary/20 transition-colors text-left">
              <div className="flex items-center justify-between">
                <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center">
                  <tile.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div>
                <p className="text-sm font-medium">{tile.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{tile.desc}</p>
              </div>
              <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">{tile.stat}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
