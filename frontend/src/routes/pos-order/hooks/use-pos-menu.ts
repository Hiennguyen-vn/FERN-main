import { useQuery } from '@tanstack/react-query';
import { productApi, type ModifierGroupView, type ProductView } from '@/api/product-api';
import { useAuth } from '@/auth/use-auth';

export interface PosMenuItem {
  id: string;
  name: string;
  categoryCode: string;
  imageUrl: string | null;
  price: number;
  hasModifiers: boolean;
  isAvailable: boolean;
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
}

function displayCategoryName(code: string) {
  if (!code) return 'Khác';
  const cleaned = code.replace(/[_-]+/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function mergeMenu(
  products: ProductView[],
  prices: Array<{ productId?: string | null; priceValue?: number; priceAmount?: number }>,
  groups: ModifierGroupView[],
): PosMenuData {
  const priceByProduct = new Map<string, number>();
  for (const p of prices) {
    const pid = p.productId ?? '';
    if (!pid) continue;
    const value = Number(p.priceValue ?? p.priceAmount ?? 0) || 0;
    priceByProduct.set(pid, value);
  }
  const activeGroups = groups.filter((g) => g.isActive !== false);
  const hasActiveModifiers = activeGroups.length > 0;
  let missingPriceCount = 0;
  const menu: PosMenuItem[] = products
    .filter((p) => (p.status ?? 'active') === 'active')
    .map((p) => {
      const price = priceByProduct.get(p.id) ?? 0;
      const isAvailable = price > 0;
      if (!isAvailable) missingPriceCount += 1;
      return {
        id: p.id,
        name: p.name ?? p.code ?? 'Sản phẩm',
        categoryCode: (p.categoryCode ?? '').trim() || 'uncategorized',
        imageUrl: p.imageUrl ?? null,
        price,
        hasModifiers: hasActiveModifiers,
        isAvailable,
      };
    });

  const countByCat = new Map<string, number>();
  for (const item of menu) {
    if (!item.isAvailable) continue;
    countByCat.set(item.categoryCode, (countByCat.get(item.categoryCode) ?? 0) + 1);
  }
  const categories: PosMenuCategory[] = Array.from(countByCat.entries())
    .map(([code, count]) => ({ code, name: displayCategoryName(code), count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { menu: menu.filter((m) => m.isAvailable), categories, modifierGroups: activeGroups, missingPriceCount };
}

export function usePosMenu(outletId: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken;
  return useQuery({
    queryKey: ['pos-order-menu', outletId, token],
    enabled: !!token && !!outletId,
    queryFn: async () => {
      const [products, prices, groups] = await Promise.all([
        productApi.products(token!),
        productApi.prices(token!, outletId!),
        productApi.modifierGroups(token!),
      ]);
      return mergeMenu(products, prices, groups);
    },
    staleTime: 30_000,
  });
}
