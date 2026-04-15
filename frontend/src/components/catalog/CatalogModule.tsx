import { useCallback, useEffect, useState } from 'react';
import {
  Package, Leaf, BookOpen, DollarSign, Search, RefreshCw, Plus, Save, Trash2, Pause,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  productApi, salesApi,
  type ItemView, type PriceView, type ProductView, type PromotionView, type RecipeView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useAuth } from '@/auth/use-auth';
import { hasCatalogMutationAccess } from '@/auth/authorization';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, PermissionBanner, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { StatusBadge } from '@/components/catalog/StatusBadge';
import { ProductListPanel } from '@/components/catalog/ProductListPanel';
import { ProductDetailPanel } from '@/components/catalog/ProductDetailPanel';
import { CatalogControlTower } from '@/components/catalog/CatalogControlTower';
import { IngredientDrawer } from '@/components/catalog/IngredientDrawer';
import { LayoutDashboard, FolderTree, Layers, LayoutGrid, GitBranch, Rocket, History } from 'lucide-react';
import { CategoryManager } from '@/components/catalog/CategoryManager';
import { MenuAssignment } from '@/components/catalog/MenuAssignment';
import { ScopeOverrideExplorer } from '@/components/catalog/ScopeOverrideExplorer';
import { PublishCenter } from '@/components/catalog/PublishCenter';
import { ChangeHistory } from '@/components/catalog/ChangeHistory';
import { VariantsModule } from '@/components/catalog/VariantsModule';

// ─── Types ────────────────────────────────────────────────────────────────

type CatTab = 'overview' | 'products' | 'ingredients' | 'recipes' | 'pricing' | 'categories' | 'menus' | 'overrides' | 'publish' | 'history' | 'variants';

const TABS: { key: CatTab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'ingredients', label: 'Ingredients', icon: Leaf },
  { key: 'recipes', label: 'Recipes', icon: BookOpen },
  { key: 'pricing', label: 'Pricing', icon: DollarSign },
  { key: 'categories', label: 'Categories', icon: FolderTree },
  { key: 'menus', label: 'Menus', icon: LayoutGrid },
  { key: 'overrides', label: 'Overrides', icon: GitBranch },
  { key: 'publish', label: 'Publish', icon: Rocket },
  { key: 'history', label: 'History', icon: History },
  { key: 'variants', label: 'Variants', icon: Layers },
];

const READ_ONLY_TABS = TABS.filter((tab) => ['products', 'recipes', 'pricing'].includes(tab.key));

const ITEM_CATEGORY_OPTIONS = ['ingredient'];
const ITEM_UOM_OPTIONS = ['g', 'kg', 'ml', 'cup'];
const RECIPE_STATUS_OPTIONS = ['draft', 'active'];
const RECIPE_YIELD_UOM_OPTIONS = ['cup', 'g', 'kg', 'ml'];

type RecipeLineDraft = { key: string; itemId: string; qtyRequired: string; uomCode: string };

function normalizeNumeric(v: string | undefined) {
  const t = String(v ?? '').trim();
  return /^\d+$/.test(t) ? t : '';
}

function nextKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────

export function CatalogModule() {
  const { session } = useAuth();
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);
  const [activeTab, setActiveTab] = useState<CatTab>('overview');
  const [selectedProduct, setSelectedProduct] = useState<ProductView | null>(null);
  const [productRefreshKey, setProductRefreshKey] = useState(0);
  const [selectedItem, setSelectedItem] = useState<ItemView | null>(null);

  // Ingredient state
  const [items, setItems] = useState<ItemView[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsHasMore, setItemsHasMore] = useState(false);
  const [itemForm, setItemForm] = useState({ code: '', name: '', categoryCode: 'ingredient', unitCode: 'kg', minStockLevel: '0' });
  const [actionBusy, setActionBusy] = useState('');

  // Recipe state
  const [recipeProducts, setRecipeProducts] = useState<ProductView[]>([]);
  const [recipesByProductId, setRecipesByProductId] = useState<Record<string, RecipeView | null>>({});
  const [recipeTotal, setRecipeTotal] = useState(0);
  const [recipeHasMore, setRecipeHasMore] = useState(false);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [selectedRecipeProductId, setSelectedRecipeProductId] = useState('');
  const [productOptions, setProductOptions] = useState<ProductView[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemView[]>([]);
  const [recipeForm, setRecipeForm] = useState({ productId: '', version: 'v1', yieldQty: '1', yieldUomCode: 'cup', status: 'draft' });
  const [recipeLines, setRecipeLines] = useState<RecipeLineDraft[]>([]);

  // Pricing state
  const [prices, setPrices] = useState<PriceView[]>([]);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesTotal, setPricesTotal] = useState(0);
  const [pricesHasMore, setPricesHasMore] = useState(false);
  const [priceForm, setPriceForm] = useState({ productId: '', priceAmount: '0', effectiveFrom: new Date().toISOString().slice(0, 10) });
  const [promotions, setPromotions] = useState<PromotionView[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(false);
  const [promotionsTotal, setPromotionsTotal] = useState(0);
  const [promotionsHasMore, setPromotionsHasMore] = useState(false);

  // Query states
  const itemsQuery = useListQueryState({ initialLimit: 25, initialSortBy: 'name', initialSortDir: 'asc' as const });
  const recipesQuery = useListQueryState({ initialLimit: 25, initialSortBy: 'name', initialSortDir: 'asc' as const });
  const pricesQuery = useListQueryState<{ outletId?: string }>({ initialLimit: 25, initialSortBy: 'effectiveFrom', initialSortDir: 'desc' as const, initialFilters: { outletId: outletId || undefined } });
  const promotionsQuery = useListQueryState<{ outletId?: string; status?: string }>({ initialLimit: 25, initialSortBy: 'effectiveFrom', initialSortDir: 'desc' as const, initialFilters: { outletId: outletId || undefined, status: undefined } });
  const patchPriceFilters = pricesQuery.patchFilters;
  const patchPromotionFilters = promotionsQuery.patchFilters;
  const canManageCatalog = hasCatalogMutationAccess(session);
  const visibleTabs = canManageCatalog ? TABS : READ_ONLY_TABS;

  // ── Data loading ──

  const loadItems = useCallback(async () => {
    if (!token) return;
    setItemsLoading(true);
    try {
      const r = await productApi.itemsPaged(token, { q: itemsQuery.debouncedSearch || undefined, sortBy: itemsQuery.sortBy, sortDir: itemsQuery.sortDir, limit: itemsQuery.limit, offset: itemsQuery.offset });
      setItems(r.items); setItemsTotal(r.totalCount); setItemsHasMore(r.items.length >= itemsQuery.limit);
    } catch (e) { toast.error(getErrorMessage(e, 'Failed to load items')); } finally { setItemsLoading(false); }
  }, [token, itemsQuery.debouncedSearch, itemsQuery.sortBy, itemsQuery.sortDir, itemsQuery.limit, itemsQuery.offset]);

  const loadRecipes = useCallback(async () => {
    if (!token) return;
    setRecipesLoading(true);
    try {
      const r = await productApi.productsPaged(token, { q: recipesQuery.debouncedSearch || undefined, sortBy: recipesQuery.sortBy, sortDir: recipesQuery.sortDir, limit: recipesQuery.limit, offset: recipesQuery.offset });
      setRecipeProducts(r.items); setRecipeTotal(r.totalCount); setRecipeHasMore(r.items.length >= recipesQuery.limit);
      const byId: Record<string, RecipeView | null> = {};
      await Promise.all(r.items.map(async p => { try { byId[String(p.id)] = await productApi.recipe(token, String(p.id)); } catch { byId[String(p.id)] = null; } }));
      setRecipesByProductId(byId);
    } catch (e) { toast.error(getErrorMessage(e, 'Failed to load recipes')); } finally { setRecipesLoading(false); }
  }, [token, recipesQuery.debouncedSearch, recipesQuery.sortBy, recipesQuery.sortDir, recipesQuery.limit, recipesQuery.offset]);

  const loadPricing = useCallback(async () => {
    if (!token || !outletId) return;
    setPricesLoading(true);
    try {
      const r = await productApi.pricesPaged(token, { outletId, q: pricesQuery.debouncedSearch || undefined, sortBy: pricesQuery.sortBy, sortDir: pricesQuery.sortDir, limit: pricesQuery.limit, offset: pricesQuery.offset });
      setPrices(r.items); setPricesTotal(r.totalCount); setPricesHasMore(r.items.length >= pricesQuery.limit);
    } catch (e) { toast.error(getErrorMessage(e, 'Failed to load prices')); } finally { setPricesLoading(false); }
  }, [token, outletId, pricesQuery.debouncedSearch, pricesQuery.sortBy, pricesQuery.sortDir, pricesQuery.limit, pricesQuery.offset]);

  const loadPromotions = useCallback(async () => {
    if (!token || !outletId) return;
    setPromotionsLoading(true);
    try {
      const r = await salesApi.promotions(token, { outletId, status: promotionsQuery.filters.status, q: promotionsQuery.debouncedSearch || undefined, sortBy: promotionsQuery.sortBy, sortDir: promotionsQuery.sortDir, limit: promotionsQuery.limit, offset: promotionsQuery.offset });
      setPromotions(r.items); setPromotionsTotal(r.totalCount); setPromotionsHasMore(r.items.length >= promotionsQuery.limit);
    } catch { /* optional */ } finally { setPromotionsLoading(false); }
  }, [token, outletId, promotionsQuery.filters.status, promotionsQuery.debouncedSearch, promotionsQuery.sortBy, promotionsQuery.sortDir, promotionsQuery.limit, promotionsQuery.offset]);

  const loadOptions = useCallback(async () => {
    if (!token) return;
    try { const [p, i] = await Promise.all([productApi.products(token), productApi.items(token)]); setProductOptions(p); setItemOptions(i); } catch { /* */ }
  }, [token]);

  // Tab triggers
  useEffect(() => { if (activeTab === 'ingredients') void loadItems(); }, [activeTab, loadItems]);
  useEffect(() => { if (activeTab === 'recipes') { void loadRecipes(); void loadOptions(); } }, [activeTab, loadRecipes, loadOptions]);
  useEffect(() => {
    if (activeTab !== 'pricing') return;
    void loadPricing();
    if (canManageCatalog) void loadPromotions();
    void loadOptions();
  }, [activeTab, canManageCatalog, loadPricing, loadPromotions, loadOptions]);
  useEffect(() => { patchPriceFilters({ outletId: outletId || undefined }); }, [outletId, patchPriceFilters]);
  useEffect(() => { patchPromotionFilters({ outletId: outletId || undefined }); }, [outletId, patchPromotionFilters]);
  useEffect(() => {
    if (visibleTabs.some((tab) => tab.key === activeTab)) return;
    setActiveTab('products');
    setSelectedProduct(null);
  }, [activeTab, visibleTabs]);

  // ── Actions ──

  const createItem = async () => {
    if (!itemForm.code.trim() || !itemForm.name.trim()) { toast.error('Code and Name required'); return; }
    setActionBusy('create-item');
    try {
      await productApi.createItem(token, { code: itemForm.code, name: itemForm.name, categoryCode: itemForm.categoryCode, baseUomCode: itemForm.unitCode, minStockLevel: Number(itemForm.minStockLevel) || 0 });
      setItemForm({ code: '', name: '', categoryCode: 'ingredient', unitCode: 'kg', minStockLevel: '0' });
      toast.success('Ingredient created'); void loadItems();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed to create')); } finally { setActionBusy(''); }
  };

  const openRecipeEditor = async (productId: string, existing?: RecipeView | null) => {
    setSelectedRecipeProductId(productId);
    setRecipeForm(f => ({ ...f, productId }));
    if (existing?.version) {
      setRecipeForm({ productId, version: existing.version || 'v1', yieldQty: String(existing.yieldQty || 1), yieldUomCode: existing.yieldUomCode || 'cup', status: existing.status || 'draft' });
      setRecipeLines((existing.items || []).map(l => ({ key: nextKey(), itemId: String(l.itemId || ''), qtyRequired: String(l.qtyRequired ?? (l as Record<string,unknown>).qty ?? 0), uomCode: String(l.uomCode || 'g') })));
    } else {
      setRecipeForm(f => ({ ...f, productId, version: 'v1', yieldQty: '1', yieldUomCode: 'cup', status: 'draft' }));
      setRecipeLines([]);
      try { const r = await productApi.recipe(token, productId); if (r?.version) { setRecipeForm({ productId, version: r.version, yieldQty: String(r.yieldQty || 1), yieldUomCode: r.yieldUomCode || 'cup', status: r.status || 'draft' }); setRecipeLines((r.items || []).map(l => ({ key: nextKey(), itemId: String(l.itemId || ''), qtyRequired: String(l.qtyRequired ?? (l as Record<string,unknown>).qty ?? 0), uomCode: String(l.uomCode || 'g') }))); } } catch { /* */ }
    }
  };

  const resolveUom = (itemId: string) => String(itemOptions.find(i => String(i.id) === itemId)?.baseUomCode || itemOptions.find(i => String(i.id) === itemId)?.unitCode || 'g');
  const addRecipeLine = () => setRecipeLines(p => [...p, { key: nextKey(), itemId: '', qtyRequired: '0', uomCode: 'g' }]);
  const removeRecipeLine = (key: string) => setRecipeLines(p => p.filter(l => l.key !== key));
  const updateRecipeLine = (key: string, patch: Partial<RecipeLineDraft>) => setRecipeLines(p => p.map(l => l.key === key ? { ...l, ...patch } : l));
  const updateLineItem = (key: string, itemId: string) => { const uom = resolveUom(itemId); setRecipeLines(p => p.map(l => l.key === key ? { ...l, itemId, uomCode: uom } : l)); };

  const saveRecipe = async () => {
    if (!recipeForm.productId) return;
    setActionBusy('save-recipe');
    try {
      await productApi.upsertRecipe(token, recipeForm.productId, { version: recipeForm.version, yieldQty: Number(recipeForm.yieldQty), yieldUomCode: recipeForm.yieldUomCode, status: recipeForm.status, items: recipeLines.filter(l => l.itemId).map(l => ({ itemId: l.itemId, qtyRequired: Number(l.qtyRequired), uomCode: l.uomCode })) });
      toast.success('Recipe saved'); void loadRecipes();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed to save recipe')); } finally { setActionBusy(''); }
  };

  const upsertPrice = async () => {
    if (!priceForm.productId || !outletId) return;
    setActionBusy('upsert-price');
    try {
      await productApi.upsertPrice(token, { productId: priceForm.productId, outletId, priceAmount: Number(priceForm.priceAmount), effectiveFrom: priceForm.effectiveFrom });
      toast.success('Price saved'); void loadPricing();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setActionBusy(''); }
  };

  const deactivatePromotion = async (id: string) => {
    setActionBusy(`deact:${id}`);
    try { await salesApi.deactivatePromotion(token, id); toast.success('Deactivated'); void loadPromotions(); } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setActionBusy(''); }
  };

  const selectedRecipeProduct = productOptions.find(p => String(p.id) === recipeForm.productId) || recipeProducts.find(p => String(p.id) === recipeForm.productId) || null;

  if (!token) return <ServiceUnavailablePage state="service_unavailable" moduleName="Catalog" />;

  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Tab bar */}
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => { setActiveTab(t.key); setSelectedProduct(null); }}
            className={cn('flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
              activeTab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </div>

      {!canManageCatalog ? (
        <div className="px-6 pt-4">
          <PermissionBanner
            state="read_only"
            moduleName="Catalog"
            detail="Your current role can only view product master data, recipe details, and outlet pricing."
          />
        </div>
      ) : null}

      <div className="flex-1 overflow-hidden flex">

        {/* ══ OVERVIEW ═══════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className="flex-1 overflow-y-auto">
            <CatalogControlTower token={token} outletId={outletId} onNavigate={(tab) => setActiveTab(tab as CatTab)} />
          </div>
        )}

        {/* ══ PRODUCTS ═════════════════════════════════════════════════ */}
        {activeTab === 'products' && (
          <>
            <div className={cn('border-r overflow-hidden', selectedProduct ? 'w-full md:w-[45%]' : 'w-full max-w-xl')}>
              <ProductListPanel key={productRefreshKey} token={token} selectedId={selectedProduct ? String(selectedProduct.id) : null}
                onSelect={p => setSelectedProduct(p)} compact={!!selectedProduct} canCreate={canManageCatalog} />
            </div>
            {selectedProduct ? (
              <div className="flex-1 overflow-hidden">
                <ProductDetailPanel product={selectedProduct} token={token} outletId={outletId}
                  canManageCatalog={canManageCatalog}
                  onClose={() => setSelectedProduct(null)} onProductUpdated={() => setProductRefreshKey(k => k + 1)} />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center"><Package className="h-8 w-8 mx-auto mb-2 opacity-20" /><p className="text-xs">Select a product</p></div>
              </div>
            )}
          </>
        )}

        {/* ══ INGREDIENTS ══════════════════════════════════════════════ */}
        {activeTab === 'ingredients' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div><label className="text-xs text-muted-foreground">Code</label><input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={itemForm.code} onChange={e => setItemForm(f => ({ ...f, code: e.target.value }))} /></div>
              <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Name</label><input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label className="text-xs text-muted-foreground">Category</label><select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={itemForm.categoryCode} onChange={e => setItemForm(f => ({ ...f, categoryCode: e.target.value }))}>{ITEM_CATEGORY_OPTIONS.map(c => <option key={c}>{c}</option>)}</select></div>
              <div><label className="text-xs text-muted-foreground">Unit</label><select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={itemForm.unitCode} onChange={e => setItemForm(f => ({ ...f, unitCode: e.target.value }))}>{ITEM_UOM_OPTIONS.map(c => <option key={c}>{c}</option>)}</select></div>
              <div className="flex items-end"><button onClick={() => void createItem()} disabled={!!actionBusy} className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">{actionBusy === 'create-item' ? '...' : 'Create'}</button></div>
            </div>
            <div className="surface-elevated p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Ingredients ({itemsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" /><input className="h-8 w-full sm:w-56 rounded-md border border-input bg-background pl-8 pr-3 text-xs" placeholder="Search..." value={itemsQuery.searchInput} onChange={e => itemsQuery.setSearchInput(e.target.value)} /></div>
                  <button onClick={() => void loadItems()} disabled={itemsLoading} className="h-8 px-2 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"><RefreshCw className={cn('h-3.5 w-3.5', itemsLoading && 'animate-spin')} /></button>
                </div>
              </div>
              <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-muted/30">
                <th className="text-left text-[11px] px-4 py-2.5">Code</th><th className="text-left text-[11px] px-4 py-2.5">Name</th><th className="text-left text-[11px] px-4 py-2.5">UOM</th><th className="text-right text-[11px] px-4 py-2.5">Min Stock</th><th className="text-left text-[11px] px-4 py-2.5">Status</th>
              </tr></thead><tbody>
                {itemsLoading && items.length === 0 ? <ListTableSkeleton columns={5} rows={6} /> : items.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No ingredients</td></tr> : items.map(item => (
                  <tr key={String(item.id)} onClick={() => setSelectedItem(item)} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer">
                    <td className="px-4 py-2.5 text-xs font-mono">{String(item.code || item.id)}</td>
                    <td className="px-4 py-2.5 text-sm">{String(item.name || '—')}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(item.baseUomCode || item.unitCode || '—')}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{Number(item.minStockLevel || 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={item.status} /></td>
                  </tr>
                ))}
              </tbody></table></div>
              <ListPaginationControls total={itemsTotal} limit={itemsQuery.limit} offset={itemsQuery.offset} hasMore={itemsHasMore} disabled={itemsLoading} onPageChange={itemsQuery.setPage} onLimitChange={itemsQuery.setPageSize} />
            </div>
          </div>
        )}

        {/* ══ RECIPES ═════════════════════════════════════════════════ */}
        {activeTab === 'recipes' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
              {/* Product list */}
              <div className="surface-elevated p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Product Recipes ({recipeTotal})</h3>
                  <div className="flex items-center gap-2">
                    <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" /><input className="h-8 w-full sm:w-48 rounded-md border border-input bg-background pl-8 pr-3 text-xs" placeholder="Search..." value={recipesQuery.searchInput} onChange={e => recipesQuery.setSearchInput(e.target.value)} /></div>
                    <button onClick={() => void loadRecipes()} disabled={recipesLoading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60"><RefreshCw className={cn('h-3.5 w-3.5', recipesLoading && 'animate-spin')} /></button>
                  </div>
                </div>
                <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-muted/30">
                  <th className="text-left text-[11px] px-3 py-2">Product</th><th className="text-left text-[11px] px-3 py-2">Ver</th><th className="text-left text-[11px] px-3 py-2">Status</th><th className="text-right text-[11px] px-3 py-2">Lines</th><th className="w-16"></th>
                </tr></thead><tbody>
                  {recipesLoading && recipeProducts.length === 0 ? <ListTableSkeleton columns={5} rows={6} /> : recipeProducts.map(p => {
                    const recipe = recipesByProductId[String(p.id)];
                    const active = selectedRecipeProductId === String(p.id);
                    return (
                      <tr key={String(p.id)} className={cn('border-b last:border-0', active && 'bg-primary/5')}>
                        <td className="px-3 py-2"><button onClick={() => void openRecipeEditor(String(p.id), recipe)} className="text-left"><p className="text-xs font-medium">{String(p.name || p.code)}</p><p className="text-[10px] text-muted-foreground font-mono">{String(p.code || p.id)}</p></button></td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{recipe?.version || '—'}</td>
                        <td className="px-3 py-2"><StatusBadge status={recipe?.status || (recipe ? 'draft' : undefined)} />{!recipe && <span className="text-[10px] text-muted-foreground ml-1">none</span>}</td>
                        <td className="px-3 py-2 text-right text-xs">{recipe?.items?.length || 0}</td>
                        <td className="px-3 py-2 text-right"><button onClick={() => void openRecipeEditor(String(p.id), recipe)} className="h-6 px-2 rounded border text-[10px] hover:bg-accent">{canManageCatalog ? (recipe ? 'Edit' : 'New') : 'View'}</button></td>
                      </tr>
                    );
                  })}
                </tbody></table></div>
                <ListPaginationControls total={recipeTotal} limit={recipesQuery.limit} offset={recipesQuery.offset} hasMore={recipeHasMore} disabled={recipesLoading} onPageChange={recipesQuery.setPage} onLimitChange={recipesQuery.setPageSize} />
              </div>

              {/* Recipe builder */}
              <div className="surface-elevated p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{canManageCatalog ? 'Recipe Editor' : 'Recipe Details'}</p><h3 className="text-sm font-semibold mt-0.5">{selectedRecipeProduct ? String(selectedRecipeProduct.name || selectedRecipeProduct.code) : 'Select product'}</h3></div>
                  {canManageCatalog ? (
                    <div className="flex gap-2">
                      <button onClick={() => { setRecipeLines([]); setRecipeForm(f => ({ ...f, version: 'v1', yieldQty: '1', status: 'draft' })); }} className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent">Reset</button>
                      <button onClick={() => void saveRecipe()} disabled={!recipeForm.productId || !!actionBusy} className="h-7 px-2.5 rounded bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1 disabled:opacity-60"><Save className="h-3 w-3" />{actionBusy === 'save-recipe' ? '...' : 'Save'}</button>
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2"><label className="text-[10px] text-muted-foreground">Product</label><select disabled={!canManageCatalog} className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-100 disabled:text-foreground" value={recipeForm.productId} onChange={e => void openRecipeEditor(e.target.value)}><option value="">Select</option>{productOptions.map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.name || p.code)}</option>)}</select></div>
                  <div><label className="text-[10px] text-muted-foreground">Version</label><input readOnly={!canManageCatalog} className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={recipeForm.version} onChange={e => setRecipeForm(f => ({ ...f, version: e.target.value }))} /></div>
                  <div><label className="text-[10px] text-muted-foreground">Status</label><select disabled={!canManageCatalog} className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-100 disabled:text-foreground" value={recipeForm.status} onChange={e => setRecipeForm(f => ({ ...f, status: e.target.value }))}>{RECIPE_STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></div>
                  <div><label className="text-[10px] text-muted-foreground">Yield</label><input readOnly={!canManageCatalog} type="number" min="0" step="0.001" className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={recipeForm.yieldQty} onChange={e => setRecipeForm(f => ({ ...f, yieldQty: e.target.value }))} /></div>
                  <div><label className="text-[10px] text-muted-foreground">Yield UOM</label><select disabled={!canManageCatalog} className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-100 disabled:text-foreground" value={recipeForm.yieldUomCode} onChange={e => setRecipeForm(f => ({ ...f, yieldUomCode: e.target.value }))}>{RECIPE_YIELD_UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}</select></div>
                </div>
                <div className="border rounded-lg">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
                    <p className="text-xs font-semibold">Lines ({recipeLines.length})</p>
                    {canManageCatalog ? (
                      <button onClick={addRecipeLine} disabled={itemOptions.length === 0} className="h-6 px-2 rounded border text-[10px] inline-flex items-center gap-1 hover:bg-accent disabled:opacity-60"><Plus className="h-3 w-3" />Add</button>
                    ) : null}
                  </div>
                  {recipeLines.length === 0 ? <div className="px-3 py-4 text-center text-[10px] text-muted-foreground">{canManageCatalog ? 'No lines — click Add to start building the recipe' : 'No recipe lines configured'}</div> : (
                    <div className="divide-y overflow-x-auto">{recipeLines.map((line, idx) => (
                      <div key={line.key} className={cn('grid gap-1.5 p-2 min-w-[320px]', canManageCatalog ? 'grid-cols-[minmax(120px,1fr)_70px_70px_30px]' : 'grid-cols-[minmax(120px,1fr)_70px_70px]')}>
                        <select disabled={!canManageCatalog} className="h-7 rounded border border-input bg-background px-1.5 text-[11px] disabled:opacity-100 disabled:text-foreground" value={line.itemId} onChange={e => updateLineItem(line.key, e.target.value)}><option value="">Item {idx + 1}</option>{itemOptions.map(i => <option key={String(i.id)} value={String(i.id)}>{String(i.name || i.code)}</option>)}</select>
                        <input readOnly={!canManageCatalog} type="number" min="0" step="0.001" className="h-7 rounded border border-input bg-background px-1.5 text-[11px]" value={line.qtyRequired} onChange={e => updateRecipeLine(line.key, { qtyRequired: e.target.value })} />
                        <select disabled={!canManageCatalog} className="h-7 rounded border border-input bg-background px-1 text-[11px] disabled:opacity-100 disabled:text-foreground" value={line.uomCode} onChange={e => updateRecipeLine(line.key, { uomCode: e.target.value })}>{Array.from(new Set([resolveUom(line.itemId), ...ITEM_UOM_OPTIONS])).map(u => <option key={`${line.key}-${u}`}>{u}</option>)}</select>
                        {canManageCatalog ? <button onClick={() => removeRecipeLine(line.key)} className="h-7 w-7 rounded border text-muted-foreground hover:text-foreground hover:bg-accent"><Trash2 className="h-2.5 w-2.5 mx-auto" /></button> : null}
                      </div>
                    ))}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ PRICING ═════════════════════════════════════════════════ */}
        {activeTab === 'pricing' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {!outletId ? <EmptyState title="Outlet required" description="Select an outlet from the scope bar at the top of the page, then return here to manage pricing and promotions." /> : (
              <>
                {canManageCatalog ? (
                  <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Product</label><select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={priceForm.productId} onChange={e => setPriceForm(f => ({ ...f, productId: e.target.value }))}><option value="">Select</option>{productOptions.map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.name || p.code)}</option>)}</select></div>
                    <div><label className="text-xs text-muted-foreground">Price</label><input type="number" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={priceForm.priceAmount} onChange={e => setPriceForm(f => ({ ...f, priceAmount: e.target.value }))} /></div>
                    <div className="flex items-end"><button onClick={() => void upsertPrice()} disabled={!!actionBusy} className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">{actionBusy === 'upsert-price' ? '...' : 'Save Price'}</button></div>
                  </div>
                ) : null}
                <div className="surface-elevated p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Prices ({pricesTotal})</h3>
                    <div className="flex items-center gap-2">
                      <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" /><input className="h-8 w-full sm:w-56 rounded-md border border-input bg-background pl-8 pr-3 text-xs" placeholder="Search..." value={pricesQuery.searchInput} onChange={e => pricesQuery.setSearchInput(e.target.value)} /></div>
                      <button onClick={() => void loadPricing()} disabled={pricesLoading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60"><RefreshCw className={cn('h-3.5 w-3.5', pricesLoading && 'animate-spin')} /></button>
                    </div>
                  </div>
                  <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">Product</th><th className="text-left text-[11px] px-4 py-2.5">Currency</th><th className="text-right text-[11px] px-4 py-2.5">Price</th><th className="text-left text-[11px] px-4 py-2.5">From</th>
                  </tr></thead><tbody>
                    {pricesLoading && prices.length === 0 ? <ListTableSkeleton columns={4} rows={6} /> : prices.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No prices</td></tr> : prices.map((p, i) => {
                      const prod = productOptions.find(x => String(x.id) === String(p.productId));
                      return (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2.5"><p className="text-sm">{prod ? String(prod.name || prod.code) : String(p.productId)}</p>{prod?.code && <p className="text-[10px] text-muted-foreground font-mono">{String(prod.code)}</p>}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(p.currencyCode || '—')}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-mono">{Number(p.priceValue ?? p.priceAmount ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(p.effectiveFrom || '—')}</td>
                        </tr>
                      );
                    })}
                  </tbody></table></div>
                  <ListPaginationControls total={pricesTotal} limit={pricesQuery.limit} offset={pricesQuery.offset} hasMore={pricesHasMore} disabled={pricesLoading} onPageChange={pricesQuery.setPage} onLimitChange={pricesQuery.setPageSize} />
                </div>
                {canManageCatalog ? (
                  <div className="surface-elevated p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Promotions ({promotionsTotal})</h3>
                      <div className="flex items-center gap-2">
                        <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={promotionsQuery.filters.status || 'all'} onChange={e => promotionsQuery.setFilter('status', e.target.value === 'all' ? undefined : e.target.value)}>
                          <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
                        </select>
                        <button onClick={() => void loadPromotions()} disabled={promotionsLoading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60"><RefreshCw className={cn('h-3.5 w-3.5', promotionsLoading && 'animate-spin')} /></button>
                      </div>
                    </div>
                    <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Name</th><th className="text-left text-[11px] px-4 py-2.5">Type</th><th className="text-left text-[11px] px-4 py-2.5">Status</th><th className="text-right text-[11px] px-4 py-2.5"></th>
                    </tr></thead><tbody>
                      {promotionsLoading && promotions.length === 0 ? <ListTableSkeleton columns={4} rows={3} /> : promotions.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">No promotions</td></tr> : promotions.map(p => (
                        <tr key={String(p.id)} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2.5 text-sm font-medium">{String(p.name || p.id)}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(p.promoType || '—')}</td>
                          <td className="px-4 py-2.5"><StatusBadge status={p.status} /></td>
                          <td className="px-4 py-2.5 text-right">{(p.status === 'active' || p.status === 'draft') && <button onClick={() => void deactivatePromotion(String(p.id))} disabled={actionBusy === `deact:${p.id}`} className="h-6 px-2 rounded border text-[10px] inline-flex items-center gap-1 hover:bg-accent disabled:opacity-60"><Pause className="h-2.5 w-2.5" />Deact</button>}</td>
                        </tr>
                      ))}
                    </tbody></table></div>
                    <ListPaginationControls total={promotionsTotal} limit={promotionsQuery.limit} offset={promotionsQuery.offset} hasMore={promotionsHasMore} disabled={promotionsLoading} onPageChange={promotionsQuery.setPage} onLimitChange={promotionsQuery.setPageSize} />
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* ══ MENUS ═══════════════════════════════════════════════ */}
        {activeTab === 'menus' && (
          <div className="flex-1 overflow-hidden">
            <MenuAssignment token={token} />
          </div>
        )}

        {/* ══ SCOPE OVERRIDES ════════════════════════════════════ */}
        {activeTab === 'overrides' && (
          <div className="flex-1 overflow-y-auto">
            <ScopeOverrideExplorer token={token} outletId={outletId} />
          </div>
        )}

        {/* ══ PUBLISH CENTER ══════════════════════════════════════ */}
        {activeTab === 'publish' && (
          <div className="flex-1 overflow-hidden">
            <PublishCenter token={token} />
          </div>
        )}

        {/* ══ CHANGE HISTORY ═════════════════════════════════════ */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-y-auto">
            <ChangeHistory token={token} />
          </div>
        )}

        {/* ══ CATEGORIES ═══════════════════════════════════════════ */}
        {activeTab === 'categories' && (
          <div className="flex-1 overflow-y-auto">
            <CategoryManager token={token} />
          </div>
        )}

        {/* ══ VARIANTS & MODIFIERS ═════════════════════════════════ */}
        {activeTab === 'variants' && (
          <div className="flex-1 overflow-hidden">
            <VariantsModule token={token} />
          </div>
        )}

      </div>

      {/* Ingredient detail drawer */}
      {selectedItem && (
        <IngredientDrawer
          item={selectedItem}
          token={token}
          onClose={() => setSelectedItem(null)}
          onUpdated={() => { void loadItems(); setSelectedItem(null); }}
        />
      )}
    </div>
  );
}
