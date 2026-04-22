import { useQuery } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { inventoryApi, type StockBalanceView } from '@/api/inventory-api';
import {
  productApi,
  type AvailabilityView,
  type ModifierGroupView,
  type ProductView,
  type RecipeView,
} from '@/api/product-api';
import { useAuth } from '@/auth/use-auth';

export type PosMenuUnavailableCode =
  | 'missing_price'
  | 'outlet_unavailable'
  | 'insufficient_ingredients';

export interface PosMenuItem {
  id: string;
  name: string;
  categoryCode: string;
  imageUrl: string | null;
  price: number;
  hasModifiers: boolean;
  isAvailable: boolean;
  unavailableCode?: PosMenuUnavailableCode;
  unavailableReason?: string;
}

export interface PosMenuCategory {
  code: string;
  name: string;
  count: number;
}

export interface PosMenuData {
  menu: PosMenuItem[];
  categories: PosMenuCategory[];
  modifierGroups: ModifierGroupView[];
  missingPriceCount: number;
  unavailableCount: number;
  insufficientIngredientCount: number;
}

function displayCategoryName(code: string) {
  if (!code) return 'Khác';
  const cleaned = code.replace(/[_-]+/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function toFiniteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getRecipeRequiredQuantity(recipe: RecipeView) {
  const yieldQty = toFiniteNumber(recipe.yieldQty);
  return yieldQty > 0 ? yieldQty : 1;
}

function hasInsufficientIngredients(
  recipe: RecipeView | null | undefined,
  stockByItem: Map<string, StockBalanceView> | null,
) {
  if (!recipe || recipe.status !== 'active' || !stockByItem) return false;

  const divisor = getRecipeRequiredQuantity(recipe);
  return (recipe.items || []).some((line) => {
    const itemId = String(line.itemId || '').trim();
    if (!itemId) return false;

    const stock = stockByItem.get(itemId);
    const availableQty = toFiniteNumber(stock?.qtyOnHand);
    const requiredQty = toFiniteNumber(line.qtyRequired) / divisor;

    if (requiredQty <= 0) return false;
    return availableQty < requiredQty;
  });
}

function buildAvailabilityLookup(entries: AvailabilityView[]) {
  return new Map(entries.map((entry) => [String(entry.productId), entry.available]));
}

function buildStockLookup(entries: StockBalanceView[]) {
  return new Map(entries.map((entry) => [String(entry.itemId || ''), entry]));
}

export function mergeMenu(
  products: ProductView[],
  prices: Array<{ productId?: string | null; priceValue?: number; priceAmount?: number }>,
  groups: ModifierGroupView[],
  availabilityByProduct: Map<string, boolean>,
  recipeByProduct: Map<string, RecipeView | null | undefined>,
  stockByItem: Map<string, StockBalanceView> | null,
): PosMenuData {
  const priceByProduct = new Map<string, number>();
  for (const p of prices) {
    const pid = p.productId ?? '';
    if (!pid) continue;
    const value = toFiniteNumber(p.priceValue ?? p.priceAmount);
    priceByProduct.set(pid, value);
  }
  const activeGroups = groups.filter((g) => g.isActive !== false);
  const hasActiveModifiers = activeGroups.length > 0;
  let missingPriceCount = 0;
  let unavailableCount = 0;
  let insufficientIngredientCount = 0;
  const menu: PosMenuItem[] = products
    .filter((p) => (p.status ?? 'active') === 'active')
    .map((p) => {
      const price = priceByProduct.get(p.id) ?? 0;
      let isAvailable = price > 0;
      let unavailableCode: PosMenuUnavailableCode | undefined;
      let unavailableReason: string | undefined;

      if (!isAvailable) {
        missingPriceCount += 1;
        unavailableCode = 'missing_price';
        unavailableReason = 'Chưa có giá bán cho outlet này';
      } else if (availabilityByProduct.get(p.id) === false) {
        isAvailable = false;
        unavailableCode = 'outlet_unavailable';
        unavailableReason = 'Món đang tạm ngưng bán tại outlet này';
      } else if (hasInsufficientIngredients(recipeByProduct.get(p.id), stockByItem)) {
        isAvailable = false;
        unavailableCode = 'insufficient_ingredients';
        unavailableReason = 'Không đủ nguyên liệu để làm';
        insufficientIngredientCount += 1;
      }

      if (!isAvailable) {
        unavailableCount += 1;
      }

      return {
        id: p.id,
        name: p.name ?? p.code ?? 'Sản phẩm',
        categoryCode: (p.categoryCode ?? '').trim() || 'uncategorized',
        imageUrl: p.imageUrl ?? null,
        price,
        hasModifiers: hasActiveModifiers,
        isAvailable,
        unavailableCode,
        unavailableReason,
      };
    });

  const visibleMenu = menu.filter((item) => item.unavailableCode !== 'missing_price');

  const countByCat = new Map<string, number>();
  for (const item of visibleMenu) {
    countByCat.set(item.categoryCode, (countByCat.get(item.categoryCode) ?? 0) + 1);
  }
  const categories: PosMenuCategory[] = Array.from(countByCat.entries())
    .map(([code, count]) => ({ code, name: displayCategoryName(code), count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    menu: visibleMenu,
    categories,
    modifierGroups: activeGroups,
    missingPriceCount,
    unavailableCount: visibleMenu.filter((item) => !item.isAvailable).length,
    insufficientIngredientCount,
  };
}

async function loadRecipes(
  token: string,
  productIds: string[],
): Promise<Map<string, RecipeView | null | undefined>> {
  const recipesByProduct = new Map<string, RecipeView | null | undefined>();
  const batchSize = 24;

  for (let index = 0; index < productIds.length; index += batchSize) {
    const batch = productIds.slice(index, index + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (productId) => {
        try {
          return await productApi.recipe(token, productId);
        } catch (error) {
          if (isApiError(error) && error.status === 404) {
            return null;
          }
          return undefined;
        }
      }),
    );

    settled.forEach((result, batchIndex) => {
      recipesByProduct.set(
        batch[batchIndex],
        result.status === 'fulfilled' ? result.value : undefined,
      );
    });
  }

  return recipesByProduct;
}

export function usePosMenu(outletId: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken;
  return useQuery({
    queryKey: ['pos-order-menu', outletId, token],
    enabled: !!token && !!outletId,
    queryFn: async () => {
      const [products, prices, groups, outletAvailability, stockBalances] = await Promise.all([
        productApi.products(token!),
        productApi.prices(token!, outletId!),
        productApi.modifierGroups(token!),
        productApi.availability(token!, { outletId: outletId! }).catch(() => [] as AvailabilityView[]),
        inventoryApi.balances(token!, outletId!).catch((): StockBalanceView[] | null => null),
      ]);

      const priceByProduct = new Map(
        prices.map((price) => [
          String(price.productId || ''),
          toFiniteNumber(price.priceValue ?? price.priceAmount),
        ]),
      );
      const activePricedProductIds = products
        .filter((product) => (product.status ?? 'active') === 'active')
        .map((product) => ({
          id: product.id,
          price: priceByProduct.get(product.id) ?? 0,
        }))
        .filter((product) => toFiniteNumber(product.price) > 0)
        .map((product) => product.id);

      const recipesByProduct = await loadRecipes(token!, activePricedProductIds);

      return mergeMenu(
        products,
        prices,
        groups,
        buildAvailabilityLookup(outletAvailability),
        recipesByProduct,
        stockBalances ? buildStockLookup(stockBalances) : null,
      );
    },
    staleTime: 30_000,
  });
}
