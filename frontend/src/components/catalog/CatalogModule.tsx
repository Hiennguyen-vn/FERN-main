import { useCallback, useEffect, useState } from 'react';
import {
  Package, Leaf, BookOpen, DollarSign, Search, RefreshCw, Plus, Save, Trash2, Pause,
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
import { isApiError } from '@/api/client';
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

const PRODUCT_CATEGORY_OPTIONS = ['beverage'];
const ITEM_CATEGORY_OPTIONS = ['ingredient'];
const ITEM_UOM_OPTIONS = ['g', 'kg', 'ml', 'cup'];
const RECIPE_STATUS_OPTIONS = ['draft', 'active'];
const RECIPE_YIELD_UOM_OPTIONS = ['cup', 'g', 'kg', 'ml'];
const PROMOTION_TYPE_OPTIONS = [
  { value: 'percentage', label: 'Percentage off' },
  { value: 'fixed_amount', label: 'Fixed amount off' },
] as const;
const PROMOTION_STATUS_CLASS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-sky-100 text-sky-700',
  inactive: 'bg-muted text-muted-foreground',
  expired: 'bg-rose-100 text-rose-700',
  draft: 'bg-amber-100 text-amber-700',
};

type RecipeLineDraft = {
  key: string;
  itemId: string;
  qtyRequired: string;
  uomCode: string;
};

type PromotionFormState = {
  name: string;
  promoType: string;
  valuePercent: string;
  valueAmount: string;
  minOrderAmount: string;
  maxDiscountAmount: string;
  effectiveFrom: string;
  effectiveTo: string;
};

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function nextRecipeLineKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatProductLabel(product: ProductView | null | undefined) {
  if (!product) return 'Select product';
  return String(product.name || product.code || product.id);
}

function formatItemLabel(item: ItemView | null | undefined) {
  if (!item) return 'Select item';
  return String(item.name || item.code || item.id);
}

function toDateTimeLocalValue(input?: string | Date | null) {
  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toPromotionIsoValue(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function createPromotionFormState(): PromotionFormState {
  return {
    name: '',
    promoType: PROMOTION_TYPE_OPTIONS[0].value,
    valuePercent: '10',
    valueAmount: '',
    minOrderAmount: '',
    maxDiscountAmount: '',
    effectiveFrom: toDateTimeLocalValue(new Date()),
    effectiveTo: '',
  };
}

function formatPromotionDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function formatPromotionValue(promotion: PromotionView) {
  const valuePercent = Number(promotion.valuePercent || 0);
  const valueAmount = Number(promotion.valueAmount || 0);
  if (valuePercent > 0) return `${valuePercent}%`;
  if (valueAmount > 0) return `$${valueAmount.toFixed(2)}`;
  return '—';
}

function derivePromotionStatus(promotion: PromotionView) {
  const rawStatus = String(promotion.status || 'draft').toLowerCase();
  const now = Date.now();
  const effectiveFrom = promotion.effectiveFrom ? new Date(promotion.effectiveFrom).getTime() : Number.NaN;
  const effectiveTo = promotion.effectiveTo ? new Date(promotion.effectiveTo).getTime() : Number.NaN;

  if (Number.isFinite(effectiveTo) && effectiveTo < now) return 'expired';
  if (Number.isFinite(effectiveFrom) && effectiveFrom > now) return 'scheduled';
  return rawStatus;
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
  const [itemOptions, setItemOptions] = useState<ItemView[]>([]);

  const [productForm, setProductForm] = useState({ code: '', name: '', categoryCode: 'beverage', status: 'active' });
  const [itemForm, setItemForm] = useState({ code: '', name: '', categoryCode: 'ingredient', unitCode: 'kg', minStockLevel: '0' });
  const [priceForm, setPriceForm] = useState({ productId: '', priceAmount: '0', effectiveFrom: new Date().toISOString().slice(0, 10) });
  const [promotionForm, setPromotionForm] = useState<PromotionFormState>(() => createPromotionFormState());
  const [selectedRecipeProductId, setSelectedRecipeProductId] = useState('');
  const [recipeEditorLoading, setRecipeEditorLoading] = useState(false);
  const [recipeEditorError, setRecipeEditorError] = useState('');
  const [recipeForm, setRecipeForm] = useState({
    productId: '',
    version: 'v1',
    yieldQty: '1',
    yieldUomCode: RECIPE_YIELD_UOM_OPTIONS[0],
    status: RECIPE_STATUS_OPTIONS[0],
  });
  const [recipeLines, setRecipeLines] = useState<RecipeLineDraft[]>([]);

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
      const page = await productApi.productsPaged(token, { limit: 200, offset: 0, sortBy: 'name', sortDir: 'asc' });
      setProductOptions(page.items || []);
    } catch {
      setProductOptions([]);
    }
  }, [token]);

  const loadItemOptions = useCallback(async () => {
    if (!token) {
      setItemOptions([]);
      return;
    }
    try {
      const page = await productApi.itemsPaged(token, { limit: 200, offset: 0, sortBy: 'name', sortDir: 'asc' });
      setItemOptions(page.items || []);
    } catch {
      setItemOptions([]);
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
    void loadItemOptions();
  }, [loadItemOptions, loadProductOptions, loadSummary]);

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

  const resolveRecipeLineUom = useCallback((itemId: string) => {
    const item = itemOptions.find((entry) => String(entry.id) === String(itemId));
    return String(item?.baseUomCode || item?.unitCode || RECIPE_YIELD_UOM_OPTIONS[0]);
  }, [itemOptions]);

  const createRecipeLineDraft = useCallback((line?: RecipeView['items'][number] | null): RecipeLineDraft => {
    const fallbackItemId = itemOptions[0] ? String(itemOptions[0].id) : '';
    const itemId = String(line?.itemId || fallbackItemId);
    return {
      key: nextRecipeLineKey(),
      itemId,
      qtyRequired: line?.qtyRequired === null || line?.qtyRequired === undefined ? '' : String(line.qtyRequired),
      uomCode: String(line?.uomCode || resolveRecipeLineUom(itemId)),
    };
  }, [itemOptions, resolveRecipeLineUom]);

  const hydrateRecipeDraft = useCallback((productId: string, recipe: RecipeView | null) => {
    setSelectedRecipeProductId(productId);
    setRecipeEditorError('');
    setRecipeForm({
      productId,
      version: String(recipe?.version || 'v1'),
      yieldQty: recipe?.yieldQty === null || recipe?.yieldQty === undefined ? '1' : String(recipe.yieldQty),
      yieldUomCode: String(recipe?.yieldUomCode || RECIPE_YIELD_UOM_OPTIONS[0]),
      status: String(recipe?.status || RECIPE_STATUS_OPTIONS[0]),
    });
    const nextLines = Array.isArray(recipe?.items) && recipe.items.length > 0
      ? recipe.items.map((line) => createRecipeLineDraft(line))
      : [createRecipeLineDraft()];
    setRecipeLines(nextLines);
  }, [createRecipeLineDraft]);

  const openRecipeEditor = useCallback(async (productId: string, seedRecipe?: RecipeView | null) => {
    if (!token) return;
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) return;

    setSelectedRecipeProductId(normalizedProductId);
    setRecipeEditorLoading(true);
    setRecipeEditorError('');

    try {
      let recipe = seedRecipe;
      if (recipe === undefined) {
        if (normalizedProductId in recipesByProductId) {
          recipe = recipesByProductId[normalizedProductId];
        } else {
          try {
            recipe = await productApi.recipe(token, normalizedProductId);
          } catch (error: unknown) {
            if (isApiError(error) && error.status === 404) {
              recipe = null;
            } else {
              throw error;
            }
          }
        }
      }
      hydrateRecipeDraft(normalizedProductId, recipe ?? null);
    } catch (error: unknown) {
      setRecipeEditorError(getErrorMessage(error, 'Unable to load recipe'));
    } finally {
      setRecipeEditorLoading(false);
    }
  }, [hydrateRecipeDraft, recipesByProductId, token]);

  useEffect(() => {
    if (activeTab !== 'recipes') return;
    if (selectedRecipeProductId) return;
    const firstProduct = recipeProducts[0] || productOptions[0];
    if (!firstProduct) return;
    void openRecipeEditor(String(firstProduct.id), recipesByProductId[String(firstProduct.id)]);
  }, [activeTab, openRecipeEditor, productOptions, recipeProducts, recipesByProductId, selectedRecipeProductId]);

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
    setProductForm({ code: '', name: '', categoryCode: 'beverage', status: 'active' });
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
    setItemForm({ code: '', name: '', categoryCode: 'ingredient', unitCode: 'kg', minStockLevel: '0' });
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

  const createPromotion = async () => {
    if (!token || !outletId) {
      toast.error('Select an outlet scope to create a promotion');
      return;
    }

    const name = promotionForm.name.trim();
    const effectiveFrom = toPromotionIsoValue(promotionForm.effectiveFrom);
    const effectiveTo = toPromotionIsoValue(promotionForm.effectiveTo);
    const valuePercent = promotionForm.valuePercent ? Number(promotionForm.valuePercent) : null;
    const valueAmount = promotionForm.valueAmount ? Number(promotionForm.valueAmount) : null;
    const minOrderAmount = promotionForm.minOrderAmount ? Number(promotionForm.minOrderAmount) : null;
    const maxDiscountAmount = promotionForm.maxDiscountAmount ? Number(promotionForm.maxDiscountAmount) : null;

    if (!name) {
      toast.error('Promotion name is required');
      return;
    }
    if (!effectiveFrom) {
      toast.error('Effective start is required');
      return;
    }
    if (effectiveTo && new Date(effectiveTo).getTime() <= new Date(effectiveFrom).getTime()) {
      toast.error('Effective end must be later than effective start');
      return;
    }
    if (promotionForm.promoType === 'percentage' && (!Number.isFinite(valuePercent) || (valuePercent ?? 0) <= 0)) {
      toast.error('Percentage value must be greater than zero');
      return;
    }
    if (promotionForm.promoType === 'fixed_amount' && (!Number.isFinite(valueAmount) || (valueAmount ?? 0) <= 0)) {
      toast.error('Fixed discount amount must be greater than zero');
      return;
    }

    await runAction(
      'create-promotion',
      async () => {
        await salesApi.createPromotion(token, {
          name,
          promoType: promotionForm.promoType,
          valuePercent: promotionForm.promoType === 'percentage' ? valuePercent : null,
          valueAmount: promotionForm.promoType === 'fixed_amount' ? valueAmount : null,
          minOrderAmount,
          maxDiscountAmount,
          effectiveFrom,
          effectiveTo,
          outletIds: [Number(outletId)],
        });
      },
      'Promotion created',
    );
    setPromotionForm(createPromotionFormState());
  };

  const deactivatePromotion = async (promotionId: string) => {
    if (!token) return;
    await runAction(
      `deactivate-promotion:${promotionId}`,
      async () => {
        await salesApi.deactivatePromotion(token, promotionId);
      },
      'Promotion deactivated',
    );
  };

  const addRecipeLine = () => {
    setRecipeLines((current) => [...current, createRecipeLineDraft()]);
  };

  const updateRecipeLineItem = (key: string, itemId: string) => {
    setRecipeLines((current) => current.map((line) => (
      line.key === key
        ? { ...line, itemId, uomCode: resolveRecipeLineUom(itemId) }
        : line
    )));
  };

  const updateRecipeLine = (key: string, patch: Partial<Omit<RecipeLineDraft, 'key'>>) => {
    setRecipeLines((current) => current.map((line) => (
      line.key === key ? { ...line, ...patch } : line
    )));
  };

  const removeRecipeLine = (key: string) => {
    setRecipeLines((current) => {
      if (current.length <= 1) {
        return [createRecipeLineDraft()];
      }
      return current.filter((line) => line.key !== key);
    });
  };

  const resetRecipeDraft = async () => {
    const productId = recipeForm.productId || selectedRecipeProductId;
    if (!productId) {
      setRecipeEditorError('');
      setRecipeForm({
        productId: '',
        version: 'v1',
        yieldQty: '1',
        yieldUomCode: RECIPE_YIELD_UOM_OPTIONS[0],
        status: RECIPE_STATUS_OPTIONS[0],
      });
      setRecipeLines([createRecipeLineDraft()]);
      return;
    }
    await openRecipeEditor(productId);
  };

  const saveRecipe = async () => {
    if (!token) return;

    const productId = recipeForm.productId.trim();
    const version = recipeForm.version.trim();
    const yieldQty = Number(recipeForm.yieldQty);
    const yieldUomCode = recipeForm.yieldUomCode.trim();
    const normalizedLines = recipeLines.map((line, index) => ({
      index,
      itemId: line.itemId.trim(),
      qtyRequired: Number(line.qtyRequired),
      uomCode: line.uomCode.trim(),
    }));

    if (!productId) {
      toast.error('Select a product to manage its recipe');
      return;
    }
    if (!version) {
      toast.error('Recipe version is required');
      return;
    }
    if (!Number.isFinite(yieldQty) || yieldQty <= 0) {
      toast.error('Yield quantity must be greater than zero');
      return;
    }
    if (!yieldUomCode) {
      toast.error('Yield UOM is required');
      return;
    }
    const invalidLine = normalizedLines.find((line) => !line.itemId || !Number.isFinite(line.qtyRequired) || line.qtyRequired <= 0 || !line.uomCode);
    if (invalidLine) {
      toast.error(`Recipe line ${invalidLine.index + 1} is incomplete`);
      return;
    }

    setActionBusy('save-recipe');
    setRecipeEditorError('');
    try {
      await productApi.upsertRecipe(token, productId, {
        version,
        yieldQty,
        yieldUomCode,
        status: recipeForm.status,
        items: normalizedLines.map((line) => ({
          itemId: line.itemId,
          qtyRequired: line.qtyRequired,
          uomCode: line.uomCode,
        })),
      });
      const latestRecipe = await productApi.recipe(token, productId);
      setRecipesByProductId((current) => ({ ...current, [productId]: latestRecipe }));
      hydrateRecipeDraft(productId, latestRecipe);
      toast.success('Recipe saved');
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unable to save recipe');
      setRecipeEditorError(message);
      toast.error(message);
    } finally {
      setActionBusy('');
    }
  };

  const selectedRecipeProduct = (
    productOptions.find((product) => String(product.id) === recipeForm.productId)
    || recipeProducts.find((product) => String(product.id) === recipeForm.productId)
    || null
  );
  const selectedRecipe = recipeForm.productId ? recipesByProductId[recipeForm.productId] || null : null;
  const promotionScopeLabel = scope.outletName || scope.regionName || 'Current scope';

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
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={productForm.categoryCode}
                  onChange={(e) => setProductForm((p) => ({ ...p, categoryCode: e.target.value }))}
                >
                  {PRODUCT_CATEGORY_OPTIONS.map((categoryCode) => (
                    <option key={categoryCode} value={categoryCode}>{categoryCode}</option>
                  ))}
                </select>
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
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={itemForm.categoryCode}
                  onChange={(e) => setItemForm((p) => ({ ...p, categoryCode: e.target.value }))}
                >
                  {ITEM_CATEGORY_OPTIONS.map((categoryCode) => (
                    <option key={categoryCode} value={categoryCode}>{categoryCode}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit</label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={itemForm.unitCode}
                  onChange={(e) => setItemForm((p) => ({ ...p, unitCode: e.target.value }))}
                >
                  {ITEM_UOM_OPTIONS.map((unitCode) => (
                    <option key={unitCode} value={unitCode}>{unitCode}</option>
                  ))}
                </select>
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
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-4">
            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Recipes ({recipeTotal})</h3>
                  <p className="text-xs text-muted-foreground">Open a product on the left, then edit the recipe on the right.</p>
                </div>
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
                      <th className="text-right text-[11px] px-4 py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipesLoading && recipeProducts.length === 0 ? (
                      <ListTableSkeleton columns={5} rows={6} />
                    ) : recipeProducts.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No products found</td></tr>
                    ) : recipeProducts.map((product) => {
                      const recipe = recipesByProductId[String(product.id)];
                      const isSelected = String(product.id) === selectedRecipeProductId;
                      return (
                        <tr
                          key={String(product.id)}
                          className={cn(
                            'border-b last:border-0 transition-colors',
                            isSelected ? 'bg-accent/40' : 'hover:bg-muted/20',
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              onClick={() => void openRecipeEditor(String(product.id), recipe)}
                              className="text-left"
                            >
                              <div className="text-sm font-medium">{String(product.name || product.code || product.id)}</div>
                              <div className="text-[11px] text-muted-foreground font-mono">{String(product.code || product.id)}</div>
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{recipe?.version || '—'}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                                recipe?.status === 'active'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : recipe
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {recipe?.status || 'No recipe'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs">{Array.isArray(recipe?.items) ? recipe.items.length : 0}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => void openRecipeEditor(String(product.id), recipe)}
                              className="h-7 px-2.5 rounded border text-[11px] hover:bg-accent"
                            >
                              {recipe ? 'Edit' : 'Create'}
                            </button>
                          </td>
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

            <div className="surface-elevated p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recipe Editor</p>
                  <h3 className="text-base font-semibold mt-1">{formatProductLabel(selectedRecipeProduct)}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedRecipe
                      ? `Latest saved version ${selectedRecipe.version || '—'} with ${selectedRecipe.items?.length || 0} line(s).`
                      : 'No saved recipe yet. Fill the form below to create one.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void resetRecipeDraft()}
                    disabled={recipeEditorLoading || actionBusy === 'save-recipe'}
                    className="h-8 px-3 rounded border text-[11px] hover:bg-accent disabled:opacity-60"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveRecipe()}
                    disabled={recipeEditorLoading || actionBusy === 'save-recipe' || itemOptions.length === 0}
                    className="h-8 px-3 rounded bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {actionBusy === 'save-recipe' ? 'Saving...' : 'Save Recipe'}
                  </button>
                </div>
              </div>

              {recipeEditorError ? <p className="text-xs text-destructive">{recipeEditorError}</p> : null}
              {itemOptions.length === 0 ? (
                <p className="text-xs text-destructive">No item options are available. Create items first before maintaining recipes.</p>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Product</label>
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={recipeForm.productId}
                    onChange={(event) => void openRecipeEditor(event.target.value)}
                  >
                    <option value="">Select product</option>
                    {productOptions.map((product) => (
                      <option key={String(product.id)} value={String(product.id)}>
                        {formatProductLabel(product)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Version</label>
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={recipeForm.version}
                    onChange={(event) => setRecipeForm((current) => ({ ...current, version: event.target.value }))}
                    placeholder="v1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Status</label>
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={recipeForm.status}
                    onChange={(event) => setRecipeForm((current) => ({ ...current, status: event.target.value }))}
                  >
                    {RECIPE_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Yield Qty</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={recipeForm.yieldQty}
                    onChange={(event) => setRecipeForm((current) => ({ ...current, yieldQty: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Yield UOM</label>
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={recipeForm.yieldUomCode}
                    onChange={(event) => setRecipeForm((current) => ({ ...current, yieldUomCode: event.target.value }))}
                  >
                    {RECIPE_YIELD_UOM_OPTIONS.map((uomCode) => (
                      <option key={uomCode} value={uomCode}>{uomCode}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border rounded-lg">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20">
                  <div>
                    <p className="text-sm font-semibold">Line Items</p>
                    <p className="text-[11px] text-muted-foreground">Add every ingredient line you need for this recipe version.</p>
                  </div>
                  <button
                    type="button"
                    onClick={addRecipeLine}
                    disabled={itemOptions.length === 0}
                    className="h-8 px-2.5 rounded border text-[11px] inline-flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add line
                  </button>
                </div>
                <div className="divide-y">
                  {recipeLines.map((line, index) => {
                    const selectedItem = itemOptions.find((item) => String(item.id) === line.itemId) || null;
                    return (
                      <div key={line.key} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_140px_120px_44px] gap-3 p-3">
                        <div>
                          <label className="text-[11px] text-muted-foreground">Item {index + 1}</label>
                          <select
                            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={line.itemId}
                            onChange={(event) => updateRecipeLineItem(line.key, event.target.value)}
                          >
                            <option value="">Select item</option>
                            {itemOptions.map((item) => (
                              <option key={String(item.id)} value={String(item.id)}>
                                {formatItemLabel(item)}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-muted-foreground font-mono">
                            {selectedItem ? String(selectedItem.code || selectedItem.id) : 'No item selected'}
                          </p>
                        </div>
                        <div>
                          <label className="text-[11px] text-muted-foreground">Qty Required</label>
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={line.qtyRequired}
                            onChange={(event) => updateRecipeLine(line.key, { qtyRequired: event.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-muted-foreground">UOM</label>
                          <select
                            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={line.uomCode}
                            onChange={(event) => updateRecipeLine(line.key, { uomCode: event.target.value })}
                          >
                            {Array.from(new Set([resolveRecipeLineUom(line.itemId), ...ITEM_UOM_OPTIONS])).map((uomCode) => (
                              <option key={`${line.key}-${uomCode}`} value={uomCode}>{uomCode}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removeRecipeLine(line.key)}
                            className="h-9 w-9 rounded border text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label={`Remove recipe line ${index + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 mx-auto" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Recipe delete is not exposed by the current backend. Use line removal or overwrite the version you are maintaining.
              </p>
            </div>
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

            <div className="surface-elevated p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Create Promotion</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Publish a campaign directly for the outlet scope you are currently viewing.</p>
                </div>
                <div className="rounded-full border px-3 py-1 text-[11px] text-muted-foreground">
                  Scope: {promotionScopeLabel}
                </div>
              </div>
              {!outletId ? (
                <EmptyState
                  title="Outlet scope required"
                  description="Choose a specific outlet in the scope selector before creating a promotion."
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
                  <div className="md:col-span-2 xl:col-span-2">
                    <label className="text-xs text-muted-foreground">Promotion Name</label>
                    <input
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promotionForm.name}
                      onChange={(event) => setPromotionForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Happy Hour 10% Off"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Type</label>
                    <select
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promotionForm.promoType}
                      onChange={(event) => setPromotionForm((current) => ({
                        ...current,
                        promoType: event.target.value,
                        valuePercent: event.target.value === 'percentage' ? (current.valuePercent || '10') : '',
                        valueAmount: event.target.value === 'fixed_amount' ? current.valueAmount : '',
                      }))}
                    >
                      {PROMOTION_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {promotionForm.promoType === 'percentage' ? 'Percent Off' : 'Amount Off'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promotionForm.promoType === 'percentage' ? promotionForm.valuePercent : promotionForm.valueAmount}
                      onChange={(event) => setPromotionForm((current) => (
                        current.promoType === 'percentage'
                          ? { ...current, valuePercent: event.target.value }
                          : { ...current, valueAmount: event.target.value }
                      ))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Min Order</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promotionForm.minOrderAmount}
                      onChange={(event) => setPromotionForm((current) => ({ ...current, minOrderAmount: event.target.value }))}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Max Discount</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promotionForm.maxDiscountAmount}
                      onChange={(event) => setPromotionForm((current) => ({ ...current, maxDiscountAmount: event.target.value }))}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="md:col-span-2 xl:col-span-2">
                    <label className="text-xs text-muted-foreground">Effective From</label>
                    <input
                      type="datetime-local"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promotionForm.effectiveFrom}
                      onChange={(event) => setPromotionForm((current) => ({ ...current, effectiveFrom: event.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-2 xl:col-span-2">
                    <label className="text-xs text-muted-foreground">Effective To</label>
                    <input
                      type="datetime-local"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={promotionForm.effectiveTo}
                      onChange={(event) => setPromotionForm((current) => ({ ...current, effectiveTo: event.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-2 xl:col-span-2 flex items-end gap-2">
                    <button
                      onClick={() => void createPromotion()}
                      disabled={actionBusy === 'create-promotion'}
                      className="h-9 flex-1 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60"
                    >
                      {actionBusy === 'create-promotion' ? 'Creating...' : 'Create Promotion'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromotionForm(createPromotionFormState())}
                      disabled={actionBusy === 'create-promotion'}
                      className="h-9 px-3 rounded-md border text-xs hover:bg-accent disabled:opacity-60"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>

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
                    <option value="expired">Expired</option>
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
                      <th className="text-left text-[11px] px-4 py-2.5">Value</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Status</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Effective Window</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Scope</th>
                      <th className="text-right text-[11px] px-4 py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promotionsLoading && promotions.length === 0 ? (
                      <ListTableSkeleton columns={7} rows={6} />
                    ) : promotions.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No promotions found</td></tr>
                    ) : promotions.map((promo) => {
                      const displayStatus = derivePromotionStatus(promo);
                      const canDeactivate = promo.status === 'active' || promo.status === 'draft';
                      const actionKey = `deactivate-promotion:${String(promo.id)}`;
                      return (
                        <tr key={String(promo.id)} className="border-b last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="text-sm font-medium">{String(promo.name || promo.id)}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{String(promo.id)}</div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(promo.promoType || '—')}</td>
                          <td className="px-4 py-2.5 text-xs">{formatPromotionValue(promo)}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', PROMOTION_STATUS_CLASS[displayStatus] || PROMOTION_STATUS_CLASS.draft)}>
                              {displayStatus}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <div>{formatPromotionDateTime(promo.effectiveFrom)}</div>
                            <div>{promo.effectiveTo ? `to ${formatPromotionDateTime(promo.effectiveTo)}` : 'No end date'}</div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {promo.outletIds?.length ? `${promo.outletIds.length} outlet${promo.outletIds.length > 1 ? 's' : ''}` : 'All readable outlets'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {canDeactivate ? (
                              <button
                                type="button"
                                onClick={() => void deactivatePromotion(String(promo.id))}
                                disabled={actionBusy === actionKey}
                                className="h-7 px-2.5 rounded border text-[11px] inline-flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                              >
                                <Pause className="h-3.5 w-3.5" />
                                {actionBusy === actionKey ? 'Updating...' : 'Deactivate'}
                              </button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
