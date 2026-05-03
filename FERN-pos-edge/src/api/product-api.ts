import { http } from './http'
import type { MenuView, PriceView } from './types'

export const productApi = {
  listMenus: (outletId?: string | null) =>
    http.get<MenuView[]>('/product/menus', {
      params: outletId ? { outletId } : undefined,
    }),

  getMenu: (menuId: string) =>
    http.get<MenuView>(`/product/menus/${menuId}`),

  prices: (outletId: string) =>
    http.get<PriceView[]>('/product/prices', { params: { outletId } }),
}
