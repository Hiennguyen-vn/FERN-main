import {
  Package, Leaf, BookOpen, DollarSign, Tag, ShieldCheck,
  ArrowRight, Clock, AlertTriangle, CheckCircle2, Info,
  ChevronRight, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  mockProducts, mockIngredients, mockRecipes, mockPromotions,
  mockPricingRules, mockAvailability, PRODUCT_STATUS_CONFIG,
} from '@/data/mock-catalog';

interface CatalogHomeProps {
  onNavigate: (tab: 'home' | 'products' | 'ingredients' | 'recipes' | 'pricing') => void;
}

export function CatalogHome({ onNavigate }: CatalogHomeProps) {
  // ── KPI computation ──
  const activeProducts = mockProducts.filter(p => p.status === 'active').length;
  const totalProducts = mockProducts.length;
  const activeIngredients = mockIngredients.length;
  const activeRecipes = mockRecipes.filter(r => r.status === 'active').length;
  const pricingCoverage = Math.round(
    (mockProducts.filter(p => p.availableOutlets > 0).length / totalProducts) * 100
  );
  const activePromos = mockPromotions.filter(p => p.status === 'active').length;
  const scheduledPromos = mockPromotions.filter(p => p.status === 'scheduled').length;
  const availabilityCoverage = Math.round(
    ((totalProducts - mockAvailability.filter(a => !a.available).length) / totalProducts) * 100
  );

  const kpis = [
    { label: 'Active Products', value: activeProducts, sub: `of ${totalProducts}`, icon: Package, color: 'text-foreground' },
    { label: 'Ingredients', value: activeIngredients, sub: 'tracked', icon: Leaf, color: 'text-foreground' },
    { label: 'Active Recipes', value: activeRecipes, sub: 'versions', icon: BookOpen, color: 'text-foreground' },
    { label: 'Pricing Coverage', value: `${pricingCoverage}%`, sub: `${mockPricingRules.length} rules`, icon: DollarSign, color: pricingCoverage < 80 ? 'text-warning' : 'text-foreground' },
    { label: 'Active Promos', value: activePromos, sub: scheduledPromos > 0 ? `${scheduledPromos} scheduled` : 'none scheduled', icon: Tag, color: 'text-foreground' },
    { label: 'Availability', value: `${availabilityCoverage}%`, sub: `${mockAvailability.filter(a => !a.available).length} blocked`, icon: ShieldCheck, color: availabilityCoverage < 90 ? 'text-warning' : 'text-foreground' },
  ];

  // ── Navigation tiles ──
  const navTiles: { label: string; desc: string; tab: 'products' | 'ingredients' | 'recipes' | 'pricing'; icon: React.ElementType; stat: string }[] = [
    { label: 'Product Master', desc: 'Product lifecycle, categories, and SKU management', tab: 'products', icon: Package, stat: `${totalProducts} products` },
    { label: 'Ingredients & UoM', desc: 'Reference ingredients, unit conversions, allergens', tab: 'ingredients', icon: Leaf, stat: `${activeIngredients} ingredients` },
    { label: 'Recipe Management', desc: 'Versioned recipes, costing, and yield tracking', tab: 'recipes', icon: BookOpen, stat: `${mockRecipes.length} recipes` },
    { label: 'Pricing & Promos', desc: 'Outlet pricing, tax rules, promotions, availability', tab: 'pricing', icon: DollarSign, stat: `${mockPricingRules.length} price rules` },
  ];

  // ── Recent activity ──
  const recentActivity = [
    { action: 'Recipe activated', detail: 'Classic Margherita Pizza v3 → active', time: '2 days ago', module: 'Recipes', type: 'update' as const },
    { action: 'Promotion launched', detail: 'LUNCH20 — 20% off all items (Apr)', time: '3 days ago', module: 'Pricing', type: 'create' as const },
    { action: 'Product created', detail: 'Wagyu Burger added as draft', time: '1 week ago', module: 'Products', type: 'create' as const },
    { action: 'Pricing adjusted', detail: 'Marina Bay outlet — 3 products updated', time: '1 week ago', module: 'Pricing', type: 'update' as const },
    { action: 'Product discontinued', detail: 'Mushroom Soup removed from active menu', time: '2 months ago', module: 'Products', type: 'archive' as const },
    { action: 'Ingredient added', detail: 'Truffle Oil registered with inventory tracking', time: '2 months ago', module: 'Ingredients', type: 'create' as const },
  ];

  // ── Data quality alerts ──
  const draftProducts = mockProducts.filter(p => p.status === 'draft');
  const productsWithoutRecipe = mockProducts.filter(p => p.status === 'active' && !p.hasRecipe);
  const partialAvailability = mockProducts.filter(p => p.availableOutlets > 0 && p.availableOutlets < p.totalOutlets);

  const qualityItems = [
    ...(draftProducts.length > 0
      ? [{ severity: 'warning' as const, label: `${draftProducts.length} product${draftProducts.length > 1 ? 's' : ''} in draft`, detail: draftProducts.map(p => p.name).join(', '), tab: 'products' as const }]
      : []),
    ...(productsWithoutRecipe.length > 0
      ? [{ severity: 'warning' as const, label: `${productsWithoutRecipe.length} active product${productsWithoutRecipe.length > 1 ? 's' : ''} without recipe`, detail: productsWithoutRecipe.map(p => p.name).join(', '), tab: 'recipes' as const }]
      : []),
    ...(partialAvailability.length > 0
      ? [{ severity: 'info' as const, label: `${partialAvailability.length} product${partialAvailability.length > 1 ? 's' : ''} with partial outlet availability`, detail: partialAvailability.map(p => `${p.name} (${p.availableOutlets}/${p.totalOutlets})`).join(', '), tab: 'pricing' as const }]
      : []),
  ];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* ── Page Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
            <Layers className="h-3 w-3" />
            <span>HQ</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">Catalog</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Catalog Management</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            System-of-record for products, recipes, pricing, and outlet availability
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onNavigate('products')}>
            <Package className="h-3.5 w-3.5 mr-1.5" />
            New Product
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={() => onNavigate('recipes')}>
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            New Recipe
          </Button>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(kpi => (
          <div key={kpi.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
            </div>
            <p className={cn('text-xl font-semibold', kpi.color)}>{kpi.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Data Quality / Attention ── */}
      {qualityItems.length > 0 && (
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            <span className="text-[11px] font-semibold text-foreground uppercase tracking-wide">Attention Required</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{qualityItems.length} item{qualityItems.length > 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-border">
            {qualityItems.map((item, i) => (
              <button
                key={i}
                onClick={() => onNavigate(item.tab)}
                className="w-full px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors text-left group"
              >
                {item.severity === 'warning' ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 flex-shrink-0" />
                ) : (
                  <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.detail}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Grid: Nav Tiles + Recent Activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Navigation tiles — 3 cols */}
        <div className="lg:col-span-3 space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Modules</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {navTiles.map(tile => (
              <button
                key={tile.tab}
                onClick={() => onNavigate(tile.tab)}
                className="surface-elevated p-4 flex flex-col gap-3 group hover:border-primary/20 transition-colors text-left"
              >
                <div className="flex items-center justify-between">
                  <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center">
                    <tile.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{tile.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{tile.desc}</p>
                </div>
                <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">{tile.stat}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Activity — 2 cols */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Activity</h3>
          <div className="surface-elevated divide-y divide-border overflow-hidden">
            {recentActivity.map((item, i) => (
              <div key={i} className="px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors">
                <div className={cn(
                  'h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                  item.type === 'create' ? 'bg-success/10' : item.type === 'archive' ? 'bg-destructive/10' : 'bg-muted/50',
                )}>
                  {item.type === 'create' ? (
                    <CheckCircle2 className="h-3 w-3 text-success" />
                  ) : item.type === 'archive' ? (
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                  ) : (
                    <Clock className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.action}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-[10px] text-muted-foreground">{item.time}</span>
                  <p className="text-[9px] font-medium text-muted-foreground/60 uppercase mt-0.5">{item.module}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
