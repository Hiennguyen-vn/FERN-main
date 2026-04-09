import { useCallback, useEffect, useState } from 'react';
import {
  Package, Leaf, BookOpen, DollarSign, Search, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  productApi,
  salesApi,
  type ItemView,
  type PriceView,
  type ProductView,
  type PromotionView,
  type RecipeView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

type CatTab = 'home' | 'products' | 'ingredients' | 'recipes' | 'pricing';

const TABS: { key: CatTab; label: string; icon: React.ElementType }[] = [
  { key: 'home', label: 'Overview', icon: Package },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'ingredients', label: 'Items', icon: Leaf },
  { key: 'recipes', label: 'Recipes', icon: BookOpen },
  { key: 'pricing', label: 'Pricing & Promos', icon: DollarSign },
];

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

export function CatalogModule() {
  const { token, scope } = useShellRuntime();
  const outletId = normalizeNumeric(scope.outletId);
  const [activeTab, setActiveTab] = useState<CatTab>('home');

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState({
    products: 0,
    items: 0,
    prices: 0,
    recipes: 0,
    promotions: 0,
  });

  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [products, setProducts] = useState<ProductView[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productsHasMore, setProductsHasMore] = useState(false);

  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const [items, setItems] = useState<ItemView[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsHasMore, setItemsHasMore] = useState(false);

  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState('');
  const [recipeProducts, setRecipeProducts] = useState<ProductView[]>([]);
  const [recipesByProductId, setRecipesByProductId] = useState<Record<string, RecipeView | null>>({});
  const [recipeTotal, setRecipeTotal] = useState(0);
  const [recipeHasMore, setRecipeHasMore] = useState(false);

  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState('');
  const [prices, setPrices] = useState<PriceView[]>([]);
  const [pricesTotal, setPricesTotal] = useState(0);
  const [pricesHasMore, setPricesHasMore] = useState(false);

  const [promotionsLoading, setPromotionsLoading] = useState(false);
  const [promotionsError, setPromotionsError] = useState('');
  const [promotions, setPromotions] = useState<PromotionView[]>([]);
  const [promotionsTotal, setPromotionsTotal] = useState(0);
  const [promotionsHasMore, setPromotionsHasMore] = useState(false);

  const [actionBusy, setActionBusy] = useState('');

  const [productOptions, setProductOptions] = useState<ProductView[]>([]);

  const [productForm, setProductForm] = useState({ code: '', name: '', categoryCode: 'general', status: 'active' });
  const [itemForm, setItemForm] = useState({ code: '', name: '', categoryCode: 'ingredient', unitCode: 'EA', minStockLevel: '0' });
  const [priceForm, setPriceForm] = useState({ productId: '', priceAmount: '0', effectiveFrom: new Date().toISOString().slice(0, 10) });

  const productsQuery = useListQueryState({
    initialLimit: 20,
    initialSortBy: 'name',
    initialSortDir: 'asc',
  });
  const itemsQuery = useListQueryState({
    initialLimit: 20,
    initialSortBy: 'name',
    initialSortDir: 'asc',
  });
  const recipesQuery = useListQueryState({
    initialLimit: 20,
    initialSortBy: 'name',
    initialSortDir: 'asc',
  });
  const pricesQuery = useListQueryState<{ outletId?: string }>({
    initialLimit: 20,
    initialSortBy: 'effectiveFrom',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined },
  });
  const promotionsQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'effectiveFrom',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const patchPricesFilters = pricesQuery.patchFilters;
  const patchPromotionsFilters = promotionsQuery.patchFilters;

  const loadSummary = useCallback(async () => {
    if (!token) {
      setSummary({ products: 0, items: 0, prices: 0, recipes: 0, promotions: 0 });
      return;
    }
    setSummaryLoading(true);
    try {
      const [productPage, itemPage, promotionPage, pricesPage] = await Promise.all([
        productApi.productsPaged(token, { limit: 1, offset: 0 }),
        productApi.itemsPaged(token, { limit: 1, offset: 0 }),
        salesApi.promotions(token, { outletId: outletId || undefined, limit: 1, offset: 0 }),
        outletId ? productApi.pricesPaged(token, { outletId, limit: 1, offset: 0 }) : Promise.resolve(null),
      ]);
      setSummary({
        products: productPage.total || productPage.totalCount || 0,
        items: itemPage.total || itemPage.totalCount || 0,
        prices: pricesPage?.total || pricesPage?.totalCount || 0,
        recipes: 0,
        promotions: promotionPage.total || promotionPage.totalCount || 0,
      });
    } catch {
      setSummary({ products: 0, items: 0, prices: 0, recipes: 0, promotions: 0 });
    } finally {
      setSummaryLoading(false);
    }
  }, [outletId, token]);

  const loadProductOptions = useCallback(async () => {
    if (!token) {
      setProductOptions([]);
      return;
    }
    try {
      const page = await productApi.productsPaged(token, { limit: 100, offset: 0, sortBy: 'name', sortDir: 'asc' });
      setProductOptions(page.items || []);
    } catch {
      setProductOptions([]);
    }
  }, [token]);

  const loadProducts = useCallback(async () => {
    if (!token) return;
    setProductsLoading(true);
    setProductsError('');
    try {
      const page = await productApi.productsPaged(token, productsQuery.query);
      setProducts(page.items || []);
      setProductsTotal(page.total || page.totalCount || 0);
      setProductsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Catalog products load failed', error);
      setProducts([]);
      setProductsTotal(0);
      setProductsHasMore(false);
      setProductsError(getErrorMessage(error, 'Unable to load products'));
    } finally {
      setProductsLoading(false);
    }
  }, [productsQuery.query, token]);

  const loadItems = useCallback(async () => {
    if (!token) return;
    setItemsLoading(true);
    setItemsError('');
    try {
      const page = await productApi.itemsPaged(token, itemsQuery.query);
      setItems(page.items || []);
      setItemsTotal(page.total || page.totalCount || 0);
      setItemsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Catalog items load failed', error);
      setItems([]);
      setItemsTotal(0);
      setItemsHasMore(false);
      setItemsError(getErrorMessage(error, 'Unable to load items'));
    } finally {
      setItemsLoading(false);
    }
  }, [itemsQuery.query, token]);

  const loadRecipes = useCallback(async () => {
    if (!token) return;
    setRecipesLoading(true);
    setRecipesError('');
    try {
      const page = await productApi.productsPaged(token, recipesQuery.query);
      const rows = page.items || [];
      setRecipeProducts(rows);
      setRecipeTotal(page.total || page.totalCount || 0);
      setRecipeHasMore(page.hasMore || page.hasNextPage || false);

      const byProductId: Record<string, RecipeView | null> = {};
      await Promise.all(rows.map(async (product) => {
        try {
          const recipe = await productApi.recipe(token, String(product.id));
          byProductId[String(product.id)] = recipe;
        } catch {
          byProductId[String(product.id)] = null;
        }
      }));
      setRecipesByProductId(byProductId);
    } catch (error: unknown) {
      console.error('Catalog recipes load failed', error);
      setRecipeProducts([]);
      setRecipesByProductId({});
      setRecipeTotal(0);
      setRecipeHasMore(false);
      setRecipesError(getErrorMessage(error, 'Unable to load recipes'));
    } finally {
      setRecipesLoading(false);
    }
  }, [recipesQuery.query, token]);

  const loadPricesAndPromotions = useCallback(async () => {
    if (!token) return;
    setPricesLoading(true);
    setPromotionsLoading(true);
    setPricesError('');
    setPromotionsError('');
    try {
      const [pricesPage, promotionsPage] = await Promise.all([
        outletId
          ? productApi.pricesPaged(token, { ...pricesQuery.query, outletId })
          : Promise.resolve(null),
        salesApi.promotions(token, {
          ...promotionsQuery.query,
          outletId: outletId || undefined,
          status: promotionsQuery.filters.status,
        }),
      ]);

      setPrices(pricesPage?.items || []);
      setPricesTotal(pricesPage?.total || pricesPage?.totalCount || 0);
      setPricesHasMore(pricesPage?.hasMore || pricesPage?.hasNextPage || false);
      setPromotions(promotionsPage.items || []);
      setPromotionsTotal(promotionsPage.total || promotionsPage.totalCount || 0);
      setPromotionsHasMore(promotionsPage.hasMore || promotionsPage.hasNextPage || false);
    } catch (error: unknown) {
      console.error('Catalog pricing/promotions load failed', error);
      setPrices([]);
      setPricesTotal(0);
      setPricesHasMore(false);
      setPromotions([]);
      setPromotionsTotal(0);
      setPromotionsHasMore(false);
      const message = getErrorMessage(error, 'Unable to load outlet pricing');
      setPricesError(message);
      setPromotionsError(message);
    } finally {
      setPricesLoading(false);
      setPromotionsLoading(false);
    }
  }, [outletId, pricesQuery.query, promotionsQuery.filters.status, promotionsQuery.query, token]);

  useEffect(() => {
    patchPricesFilters({ outletId: outletId || undefined });
    patchPromotionsFilters({ outletId: outletId || undefined });
  }, [outletId, patchPricesFilters, patchPromotionsFilters]);

  useEffect(() => {
    void loadSummary();
    void loadProductOptions();
  }, [loadProductOptions, loadSummary]);

  useEffect(() => {
    if (activeTab !== 'products') return;
    void loadProducts();
  }, [activeTab, loadProducts]);

  useEffect(() => {
    if (activeTab !== 'ingredients') return;
    void loadItems();
  }, [activeTab, loadItems]);

  useEffect(() => {
    if (activeTab !== 'recipes') return;
    void loadRecipes();
  }, [activeTab, loadRecipes]);

  useEffect(() => {
    if (activeTab !== 'pricing') return;
    void loadPricesAndPromotions();
  }, [activeTab, loadPricesAndPromotions]);

  const runAction = async (key: string, action: () => Promise<unknown>, successMessage: string) => {
    setActionBusy(key);
    try {
      await action();
      toast.success(successMessage);
      await loadSummary();
      await loadProductOptions();
      if (activeTab === 'products') await loadProducts();
      if (activeTab === 'ingredients') await loadItems();
      if (activeTab === 'recipes') await loadRecipes();
      if (activeTab === 'pricing') await loadPricesAndPromotions();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Action failed'));
    } finally {
      setActionBusy('');
    }
  };

  const createProduct = async () => {
    if (!token) return;
    if (!productForm.code.trim() || !productForm.name.trim()) {
      toast.error('Product code and name are required');
      return;
    }
    await runAction(
      'create-product',
      async () => {
        await productApi.createProduct(token, {
          code: productForm.code.trim(),
          name: productForm.name.trim(),
          categoryCode: productForm.categoryCode,
          status: productForm.status,
        });
      },
      'Product created',
    );
    setProductForm({ code: '', name: '', categoryCode: 'general', status: 'active' });
  };

  const createItem = async () => {
    if (!token) return;
    if (!itemForm.code.trim() || !itemForm.name.trim()) {
      toast.error('Item code and name are required');
      return;
    }
    await runAction(
      'create-item',
      async () => {
        await productApi.createItem(token, {
          code: itemForm.code.trim(),
          name: itemForm.name.trim(),
          categoryCode: itemForm.categoryCode,
          unitCode: itemForm.unitCode,
          minStockLevel: Number(itemForm.minStockLevel || 0),
        });
      },
      'Item created',
    );
    setItemForm({ code: '', name: '', categoryCode: 'ingredient', unitCode: 'EA', minStockLevel: '0' });
  };

  const upsertPrice = async () => {
    if (!token || !outletId) {
      toast.error('Select an outlet scope to manage pricing');
      return;
    }
    if (!priceForm.productId) {
      toast.error('Please select a product');
      return;
    }
    await runAction(
      'upsert-price',
      async () => {
        await productApi.upsertPrice(token, {
          productId: priceForm.productId,
          outletId,
          currencyCode: 'USD',
          priceAmount: Number(priceForm.priceAmount),
          effectiveFrom: priceForm.effectiveFrom,
        });
      },
      'Price saved',
    );
    setPriceForm((prev) => ({ ...prev, priceAmount: '0' }));
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Catalog" />;
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'home' && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Products', value: summary.products },
              { label: 'Items', value: summary.items },
              { label: 'Prices', value: summary.prices },
              { label: 'Recipes', value: summary.recipes },
              { label: 'Promotions', value: summary.promotions },
            ].map((kpi) => (
              <div key={kpi.label} className="surface-elevated p-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
                <p className="text-xl font-semibold mt-1">{summaryLoading ? '…' : kpi.value}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'products' && (
          <div className="space-y-4">
            <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Code</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={productForm.code} onChange={(e) => setProductForm((p) => ({ ...p, code: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Name</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={productForm.name} onChange={(e) => setProductForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={productForm.categoryCode} onChange={(e) => setProductForm((p) => ({ ...p, categoryCode: e.target.value }))} />
              </div>
              <div className="flex items-end">
                <button onClick={() => void createProduct()} disabled={actionBusy === 'create-product'} className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">
                  {actionBusy === 'create-product' ? 'Creating...' : 'Create Product'}
                </button>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Products ({productsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search products"
                      value={productsQuery.searchInput}
                      onChange={(event) => productsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${productsQuery.sortBy || 'name'}:${productsQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      productsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="name:asc">Name A-Z</option>
                    <option value="name:desc">Name Z-A</option>
                    <option value="code:asc">Code A-Z</option>
                    <option value="code:desc">Code Z-A</option>
                  </select>
                  <button
                    onClick={() => void loadProducts()}
                    disabled={productsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', productsLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>
              {productsError ? <p className="text-xs text-destructive">{productsError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Code</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Name</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Category</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productsLoading && products.length === 0 ? (
                      <ListTableSkeleton columns={4} rows={6} />
                    ) : products.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No products found</td></tr>
                    ) : products.map((product) => (
                      <tr key={String(product.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(product.code || product.id)}</td>
                        <td className="px-4 py-2.5 text-sm">{String(product.name || '—')}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(product.categoryCode || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(product.status || '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPaginationControls
                total={productsTotal}
                limit={productsQuery.limit}
                offset={productsQuery.offset}
                hasMore={productsHasMore}
                disabled={productsLoading}
                onPageChange={productsQuery.setPage}
                onLimitChange={productsQuery.setPageSize}
              />
            </div>
          </div>
        )}

        {activeTab === 'ingredients' && (
          <div className="space-y-4">
            <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Code</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={itemForm.code} onChange={(e) => setItemForm((p) => ({ ...p, code: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Name</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={itemForm.name} onChange={(e) => setItemForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={itemForm.categoryCode} onChange={(e) => setItemForm((p) => ({ ...p, categoryCode: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit</label>
                <input className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={itemForm.unitCode} onChange={(e) => setItemForm((p) => ({ ...p, unitCode: e.target.value }))} />
              </div>
              <div className="flex items-end">
                <button onClick={() => void createItem()} disabled={actionBusy === 'create-item'} className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">
                  {actionBusy === 'create-item' ? 'Creating...' : 'Create Item'}
                </button>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Items ({itemsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search items"
                      value={itemsQuery.searchInput}
                      onChange={(event) => itemsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${itemsQuery.sortBy || 'name'}:${itemsQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      itemsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="name:asc">Name A-Z</option>
                    <option value="name:desc">Name Z-A</option>
                    <option value="code:asc">Code A-Z</option>
                    <option value="code:desc">Code Z-A</option>
                  </select>
                  <button
                    onClick={() => void loadItems()}
                    disabled={itemsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', itemsLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>
              {itemsError ? <p className="text-xs text-destructive">{itemsError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Code</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Name</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Category</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Unit</th>
                      <th className="text-right text-[11px] px-4 py-2.5">Min Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsLoading && items.length === 0 ? (
                      <ListTableSkeleton columns={5} rows={6} />
                    ) : items.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No items found</td></tr>
                    ) : items.map((item) => (
                      <tr key={String(item.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{String(item.code || item.id)}</td>
                        <td className="px-4 py-2.5 text-sm">{String(item.name || '—')}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(item.categoryCode || '—')}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(item.unitCode || item.baseUomCode || '—')}</td>
                        <td className="px-4 py-2.5 text-right text-xs">{Number(item.minStockLevel || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPaginationControls
                total={itemsTotal}
                limit={itemsQuery.limit}
                offset={itemsQuery.offset}
                hasMore={itemsHasMore}
                disabled={itemsLoading}
                onPageChange={itemsQuery.setPage}
                onLimitChange={itemsQuery.setPageSize}
              />
            </div>
          </div>
        )}

        {activeTab === 'recipes' && (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Recipes ({recipeTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search products for recipe"
                    value={recipesQuery.searchInput}
                    onChange={(event) => recipesQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <button
                  onClick={() => void loadRecipes()}
                  disabled={recipesLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', recipesLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>
            {recipesError ? <p className="text-xs text-destructive">{recipesError}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">Product</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Version</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                    <th className="text-right text-[11px] px-4 py-2.5">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {recipesLoading && recipeProducts.length === 0 ? (
                    <ListTableSkeleton columns={4} rows={6} />
                  ) : recipeProducts.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No products found</td></tr>
                  ) : recipeProducts.map((product) => {
                    const recipe = recipesByProductId[String(product.id)];
                    return (
                      <tr key={String(product.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-sm">{String(product.name || product.code || product.id)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{recipe?.version || '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{recipe?.status || 'No recipe'}</td>
                        <td className="px-4 py-2.5 text-right text-xs">{Array.isArray(recipe?.items) ? recipe.items.length : 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPaginationControls
              total={recipeTotal}
              limit={recipesQuery.limit}
              offset={recipesQuery.offset}
              hasMore={recipeHasMore}
              disabled={recipesLoading}
              onPageChange={recipesQuery.setPage}
              onLimitChange={recipesQuery.setPageSize}
            />
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="space-y-4">
            {!outletId ? (
              <EmptyState title="Outlet scope required" description="Set outlet scope to load and manage outlet pricing." />
            ) : (
              <>
                <div className="surface-elevated p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-2">
                    <label className="text-xs text-muted-foreground">Product</label>
                    <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={priceForm.productId} onChange={(e) => setPriceForm((p) => ({ ...p, productId: e.target.value }))}>
                      <option value="">Select product</option>
                      {productOptions.map((product) => (
                        <option key={String(product.id)} value={String(product.id)}>{String(product.name || product.code || product.id)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Price</label>
                    <input type="number" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={priceForm.priceAmount} onChange={(e) => setPriceForm((p) => ({ ...p, priceAmount: e.target.value }))} />
                  </div>
                  <div className="flex items-end">
                    <button onClick={() => void upsertPrice()} disabled={actionBusy === 'upsert-price'} className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">
                      {actionBusy === 'upsert-price' ? 'Saving...' : 'Save Price'}
                    </button>
                  </div>
                </div>

                <div className="surface-elevated p-4 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <h3 className="text-sm font-semibold">Outlet Pricing ({pricesTotal})</h3>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                          placeholder="Search pricing"
                          value={pricesQuery.searchInput}
                          onChange={(event) => pricesQuery.setSearchInput(event.target.value)}
                        />
                      </div>
                      <button
                        onClick={() => void loadPricesAndPromotions()}
                        disabled={pricesLoading}
                        className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', pricesLoading ? 'animate-spin' : '')} />
                        Refresh
                      </button>
                    </div>
                  </div>
                  {pricesError ? <p className="text-xs text-destructive">{pricesError}</p> : null}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left text-[11px] px-4 py-2.5">Product</th>
                          <th className="text-left text-[11px] px-4 py-2.5">Currency</th>
                          <th className="text-right text-[11px] px-4 py-2.5">Price</th>
                          <th className="text-left text-[11px] px-4 py-2.5">Effective From</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pricesLoading && prices.length === 0 ? (
                          <ListTableSkeleton columns={4} rows={6} />
                        ) : prices.length === 0 ? (
                          <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No prices found for this outlet</td></tr>
                        ) : prices.map((price) => (
                          <tr key={String(price.id || `${price.productId}-${price.effectiveFrom}`)} className="border-b last:border-0">
                            <td className="px-4 py-2.5 text-sm">{String(price.productName || price.productCode || price.productId)}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(price.currencyCode || '—')}</td>
                            <td className="px-4 py-2.5 text-right text-sm font-mono">{Number(price.priceValue ?? price.priceAmount ?? 0).toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(price.effectiveFrom || '—')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ListPaginationControls
                    total={pricesTotal}
                    limit={pricesQuery.limit}
                    offset={pricesQuery.offset}
                    hasMore={pricesHasMore}
                    disabled={pricesLoading}
                    onPageChange={pricesQuery.setPage}
                    onLimitChange={pricesQuery.setPageSize}
                  />
                </div>
              </>
            )}

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Promotions ({promotionsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search promotions"
                      value={promotionsQuery.searchInput}
                      onChange={(event) => promotionsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={promotionsQuery.filters.status || 'all'}
                    onChange={(event) => promotionsQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <button
                    onClick={() => void loadPricesAndPromotions()}
                    disabled={promotionsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', promotionsLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>
              {promotionsError ? <p className="text-xs text-destructive">{promotionsError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Promotion</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Type</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Effective</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promotionsLoading && promotions.length === 0 ? (
                      <ListTableSkeleton columns={4} rows={6} />
                    ) : promotions.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No promotions found</td></tr>
                    ) : promotions.map((promo) => (
                      <tr key={String(promo.id)} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-sm">{String(promo.name || promo.id)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(promo.promoType || '—')}</td>
                        <td className="px-4 py-2.5 text-xs">{String(promo.status || '—')}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(promo.effectiveFrom || '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPaginationControls
                total={promotionsTotal}
                limit={promotionsQuery.limit}
                offset={promotionsQuery.offset}
                hasMore={promotionsHasMore}
                disabled={promotionsLoading}
                onPageChange={promotionsQuery.setPage}
                onLimitChange={promotionsQuery.setPageSize}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
