import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppSelector } from '@/store/hooks'
import { productApi } from '@/api/product-api'
import { db } from '@/db/schema'
import type { CatalogItem } from '@/db/schema'
import type { MenuView, ModifierGroupView, ProductVariantView } from '@/api/types'

export interface PosMenuItem {
  productId: string
  productName: string
  productCode: string
  categoryId: string
  categoryName: string
  price_cents: number
  tax_basis_points: number
  isAvailable: boolean
  variants: ProductVariantView[]
  modifierGroups: ModifierGroupView[]
}

export interface PosMenuCategory {
  id: string
  name: string
  items: PosMenuItem[]
}

// Build categories from Dexie cache — groups by category_id
async function buildFromCache(outletId: string): Promise<PosMenuCategory[]> {
  const items = await db.catalog
    .where('outlet_id').equals(outletId)
    .filter(i => i.is_available && i.price_cents > 0)
    .toArray()

  if (items.length === 0) return []

  const catMap = new Map<string, { name: string; items: PosMenuItem[] }>()
  for (const item of items) {
    if (!catMap.has(item.category_id)) {
      catMap.set(item.category_id, { name: `Danh mục ${item.category_id}`, items: [] })
    }
      catMap.get(item.category_id)!.items.push({
        productId: item.id,
        productName: item.name,
        productCode: String(item.id),
        categoryId: item.category_id,
        categoryName: catMap.get(item.category_id)!.name,
        price_cents: item.price_cents,
        tax_basis_points: 0,  // Dexie cache doesn't carry tax — recomputed on next API hit
        isAvailable: true,
        variants: [],
        modifierGroups: [],
      })
    }

  return Array.from(catMap.entries()).map(([id, { name, items }]) => ({ id, name, items }))
}

// Build from mini server menu snapshot.
function buildFromApi(menu: MenuView): PosMenuCategory[] {
  return menu.categories
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(cat => ({
      id: cat.id,
      name: cat.name,
      items: cat.items
        .filter(i => i.isActive && i.productStatus === 'active')
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(item => ({
          productId: item.productId,
          productName: item.productName,
          productCode: item.productCode,
          categoryId: cat.id,
          categoryName: cat.name,
          price_cents: item.priceCents ?? 0,
          tax_basis_points: (item as { taxBasisPoints?: number }).taxBasisPoints ?? 0,
          isAvailable: (item.priceCents ?? 0) > 0,
          variants: item.variants ?? [],
          modifierGroups: item.modifierGroups ?? [],
        }))
        .filter(i => i.isAvailable),
    }))
    .filter(cat => cat.items.length > 0)
}

export function usePosMenu(menuId: string | null) {
  const outletId = useAppSelector(s => s.auth.outletId)

  // Cache-first: load from Dexie immediately
  const [cacheCategories, setCacheCategories] = useState<PosMenuCategory[]>([])
  const [cacheLoading, setCacheLoading] = useState(true)

  useEffect(() => {
    if (!outletId) return
    buildFromCache(outletId).then(cats => {
      setCacheCategories(cats)
      setCacheLoading(false)
    })
  }, [outletId])

  // API fetch (when online + menuId known)
  // queryKey carries a schema version so cache invalidates when the API shape changes
  // (e.g. adding taxBasisPoints) — bump on any breaking response shape change.
  const menuQuery = useQuery({
    queryKey: ['menu', 'v2-tax', menuId],
    queryFn: () => productApi.getMenu(menuId!).then(r => r.data),
    enabled: menuId != null,
    staleTime: 5 * 60 * 1000,
  })

  const apiCategories: PosMenuCategory[] = (() => {
    if (!menuQuery.data || !outletId) return []
    return buildFromApi(menuQuery.data)
  })()

  // Prefer API data (fresh) over cache; fall back to cache when offline
  const categories = apiCategories.length > 0 ? apiCategories : cacheCategories
  const isLoading = cacheLoading && apiCategories.length === 0

  return { categories, isLoading, isError: menuQuery.isError && cacheCategories.length === 0 }
}

export function useMenuList() {
  const outletId = useAppSelector(s => s.auth.outletId)
  return useQuery({
    queryKey: ['menus', 'v2-tax', outletId],
    queryFn: () => productApi.listMenus(outletId).then(r => r.data),
    enabled: outletId != null,
    staleTime: 10 * 60 * 1000,
  })
}

// Lookup product name from Dexie by productId — for cart display
export function useCatalogItem(productId: string): CatalogItem | undefined {
  const [item, setItem] = useState<CatalogItem | undefined>()
  useEffect(() => {
    db.catalog.get(productId).then(setItem)
  }, [productId])
  return item
}
