import { useEffect, useRef } from 'react'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { setCart, setCartContext } from '@/store/cart.slice'
import { db, type CartDraft, type SaleItemLocal } from '@/db/schema'

const CART_DRAFT_ID = 1
const DEBOUNCE_MS = 300
const BAD_PRODUCT_IDS = new Set(['3483032935567213000'])

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasBadProductId(value: string): boolean {
  return BAD_PRODUCT_IDS.has(value)
}

function isValidItem(item: SaleItemLocal): boolean {
  if (!isValidId(item.product_id) || hasBadProductId(item.product_id)) return false
  if (item.variant_id != null && !isValidId(item.variant_id)) return false
  if ((item.modifier_option_ids ?? []).some(id => !isValidId(id))) return false
  if ((item.modifiers ?? []).some(modifier => !isValidId(modifier.modifier_option_id))) return false
  return true
}

function isDraftUsable(draft: CartDraft, outletId: string | null, posSessionId: string | null): boolean {
  if (!outletId || !posSessionId) return false
  if (!draft.items.every(isValidItem)) return false
  if (draft.outletId !== outletId) return false
  if (draft.posSessionId !== posSessionId) return false
  return true
}

/** Drop items whose product disappeared from catalog or was disabled.
 * Price changes are intentionally NOT filtered: the line carries a snapshot price captured
 * at add-time and that snapshot is what got committed. */
async function revalidateAgainstCatalog(items: SaleItemLocal[]): Promise<{ kept: SaleItemLocal[]; dropped: SaleItemLocal[] }> {
  if (items.length === 0) return { kept: [], dropped: [] }
  const ids = [...new Set(items.map(i => i.product_id))]
  const catalogRows = await db.catalog.where('id').anyOf(ids).toArray()
  const okSet = new Set(catalogRows.filter(r => r.is_available).map(r => r.id))
  const kept: SaleItemLocal[] = []
  const dropped: SaleItemLocal[] = []
  for (const item of items) {
    if (okSet.has(item.product_id)) kept.push(item)
    else dropped.push(item)
  }
  return { kept, dropped }
}

/** On mount: restore cart from Dexie. On change: persist cart to Dexie (debounced). */
export function useCartPersist() {
  const dispatch = useAppDispatch()
  const cart = useAppSelector(s => s.cart)
  const outletId = useAppSelector(s => s.auth.outletId)
  const posSessionId = useAppSelector(s => s.session.current?.id ?? null)
  const isRestored = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore once on mount
  useEffect(() => {
    if (isRestored.current) return
    if (!outletId || !posSessionId) return
    db.cartDraft.get(CART_DRAFT_ID).then(async draft => {
      if (draft && draft.items.length > 0) {
        if (!isDraftUsable(draft, outletId, posSessionId)) {
          void db.cartDraft.delete(CART_DRAFT_ID)
          isRestored.current = true
          return
        }
        const { kept, dropped } = await revalidateAgainstCatalog(draft.items)
        if (dropped.length > 0) {
          console.warn('[cart-restore] dropping unavailable products', dropped.map(d => d.product_id))
        }
        dispatch(setCart({
          items: kept,
          note: draft.note,
          outletId: draft.outletId,
          posSessionId: draft.posSessionId,
        }))
      }
      isRestored.current = true
    })
  }, [dispatch, outletId, posSessionId])

  useEffect(() => {
    if (!isRestored.current || !outletId || !posSessionId) return
    if (cart.outletId === outletId && cart.posSessionId === posSessionId) return
    dispatch(setCartContext({ outletId, posSessionId }))
  }, [cart.outletId, cart.posSessionId, dispatch, outletId, posSessionId])

  // Persist on every cart change, debounced
  useEffect(() => {
    if (!isRestored.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      db.cartDraft.put({
        id: CART_DRAFT_ID,
        outletId: cart.outletId,
        posSessionId: cart.posSessionId,
        items: cart.items,
        note: cart.note,
        savedAt: Date.now(),
      })
    }, DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [cart])
}

/** Call after successful sale submission to clear persisted draft. */
export async function clearPersistedCart(): Promise<void> {
  await db.cartDraft.delete(CART_DRAFT_ID)
}
