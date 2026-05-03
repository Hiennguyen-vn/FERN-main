import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { SaleItemLocal } from '@/db/schema'

interface CartState {
  items: SaleItemLocal[]
  note: string
  outletId: string | null
  posSessionId: string | null
}

const initialState: CartState = {
  items: [],
  note: '',
  outletId: null,
  posSessionId: null,
}

function buildLineKey(item: SaleItemLocal): string {
  return item.cart_line_id
    ?? `${item.product_id}:${item.variant_id ?? 'base'}:${(item.modifier_option_ids ?? []).slice().sort((a, b) => a.localeCompare(b)).join(',')}:${item.note ?? ''}`
}

function sameVariantAndModifiers(left: SaleItemLocal, right: SaleItemLocal): boolean {
  if ((left.variant_id ?? null) !== (right.variant_id ?? null)) return false
  if ((left.note ?? null) !== (right.note ?? null)) return false
  const leftIds = [...(left.modifier_option_ids ?? [])].sort((a, b) => a.localeCompare(b))
  const rightIds = [...(right.modifier_option_ids ?? [])].sort((a, b) => a.localeCompare(b))
  return JSON.stringify(leftIds) === JSON.stringify(rightIds)
}

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    setCartContext(state, action: PayloadAction<{ outletId: string; posSessionId: string }>) {
      state.outletId = action.payload.outletId
      state.posSessionId = action.payload.posSessionId
    },
    addItem(state, action: PayloadAction<SaleItemLocal>) {
      const normalized = {
        ...action.payload,
        cart_line_id: action.payload.cart_line_id ?? buildLineKey(action.payload),
      }
      const existing = state.items.find(i =>
        i.product_id === normalized.product_id && sameVariantAndModifiers(i, normalized)
      )
      if (existing) {
        const qty = parseFloat(existing.qty) + parseFloat(normalized.qty)
        existing.qty = qty.toString()
        existing.line_total_cents = normalized.line_total_cents * qty
      } else {
        state.items.push(normalized)
      }
    },
    removeItem(state, action: PayloadAction<string>) {
      state.items = state.items.filter(i => buildLineKey(i) !== action.payload)
    },
    updateQty(state, action: PayloadAction<{ cartLineId: string; qty: number }>) {
      const item = state.items.find(i => buildLineKey(i) === action.payload.cartLineId)
      if (item) {
        if (action.payload.qty <= 0) {
          state.items = state.items.filter(i => buildLineKey(i) !== action.payload.cartLineId)
        } else {
          item.qty = action.payload.qty.toString()
          item.line_total_cents = (item.unit_price_cents * action.payload.qty) - item.discount_cents + (item.tax_cents ?? 0)
        }
      }
    },
    setNote(state, action: PayloadAction<string>) {
      state.note = action.payload
    },
    clearCart(state) {
      state.items = []
      state.note = ''
    },
    setCart(state, action: PayloadAction<{ items: SaleItemLocal[]; note: string; outletId: string | null; posSessionId: string | null }>) {
      state.items = action.payload.items
      state.note = action.payload.note
      state.outletId = action.payload.outletId
      state.posSessionId = action.payload.posSessionId
    },
  },
})

export const { setCartContext, addItem, removeItem, updateQty, setNote, clearCart, setCart } = cartSlice.actions
export default cartSlice.reducer

export const selectCartTotal = (state: { cart: CartState }) =>
  state.cart.items.reduce((sum, i) => sum + i.line_total_cents, 0)

export const selectCartSubtotal = (state: { cart: CartState }) =>
  state.cart.items.reduce((sum, i) => sum + (i.unit_price_cents * (parseFloat(i.qty) || 1) - (i.discount_cents ?? 0)), 0)

export const selectCartTax = (state: { cart: CartState }) =>
  state.cart.items.reduce((sum, i) => sum + (i.tax_cents ?? 0), 0)

export const selectCartCount = (state: { cart: CartState }) =>
  state.cart.items.reduce((sum, i) => sum + parseFloat(i.qty), 0)
