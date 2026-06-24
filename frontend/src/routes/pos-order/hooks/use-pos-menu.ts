import { useQuery } from '@tanstack/react-query';
import type { StockBalanceView } from '@/api/inventory-api';
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
  modifierGroups: ModifierGroupView[];
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
  modifierGroupsByProduct: Map<string, ModifierGroupView[]> = new Map(),
): PosMenuData {
  const priceByProduct = new Map<string, number>();
  for (const p of prices) {
    const pid = p.productId ?? '';
    if (!pid) continue;
    const value = toFiniteNumber(p.priceValue ?? p.priceAmount);
    priceByProduct.set(pid, value);
  }
  const activeGroups = groups.filter((g) => g.isActive !== false);
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

      const productModifierGroups = (modifierGroupsByProduct.get(p.id) ?? [])
        .filter((g) => g.isActive !== false);

      return {
        id: p.id,
        name: p.name ?? p.code ?? 'Sản phẩm',
        categoryCode: (p.categoryCode ?? '').trim() || 'uncategorized',
        imageUrl: p.imageUrl ?? null,
        price,
        hasModifiers: productModifierGroups.length > 0,
        modifierGroups: productModifierGroups,
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

export function usePosMenu(outletId: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken;
  return useQuery({
    queryKey: ['pos-order-menu', outletId, token],
    enabled: !!token && !!outletId,
    queryFn: async () => {
      const [products, prices, outletAvailability] = await Promise.all([
        productApi.products(token!),
        productApi.prices(token!, outletId!),
        productApi.availability(token!, { outletId: outletId! }).catch(() => [] as AvailabilityView[]),
      ]);

      return mergeMenu(
        products,
        prices,
        [],
        buildAvailabilityLookup(outletAvailability),
        new Map(),
        null,
        new Map(),
      );
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}
