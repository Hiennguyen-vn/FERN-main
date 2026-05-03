import type { PoolClient } from 'pg'

const QTY_SCALE = 6
const QTY_EPSILON = 1e-6
const UNTRACKED_QTY = 999999999

type Queryable = Pick<PoolClient, 'query'>

type RecipeComponentRow = {
  item_id: string
  component_qty: string
  yield_qty: string
  conversion_factor: string
}

type StockRow = {
  item_id: string
  qty_on_hand: string
  qty_reserved_local: string
  synced_at?: string | null
}

export type ReservationRequirement = {
  itemId: string
  qty: number
  strict: boolean
  productId: string
  basis: 'recipe' | 'product_alias'
}

export type ProductAvailability = {
  product_id: string
  outlet_id: string
  qty_available: number
  tracked_by_recipe: boolean
  basis: 'recipe' | 'product_alias' | 'untracked'
  last_synced_at: string | null
}

export async function resolveReservationRequirements(
  db: Queryable,
  items: Array<{ product_id: string; qty: string | number }>
): Promise<ReservationRequirement[]> {
  const requirements: ReservationRequirement[] = []
  for (const item of items) {
    const qty = normalizeQty(item.qty)
    if (qty <= 0) continue
    const perProduct = await resolveRequirementsForProduct(db, item.product_id, qty)
    requirements.push(...perProduct)
  }
  return requirements
}

export async function getProductAvailability(
  db: Queryable,
  outletId: string,
  productId: string
): Promise<ProductAvailability> {
  const recipeComponents = await loadRecipeComponents(db, productId)
  if (recipeComponents.length === 0) {
    const { rows } = await db.query<StockRow>(
      `SELECT item_id, qty_on_hand::text, qty_reserved_local::text, synced_at
       FROM stock_balance
       WHERE outlet_id = $1 AND item_id = $2
       LIMIT 1`,
      [outletId, productId]
    )
    if (rows.length === 0) {
      return {
        product_id: productId,
        outlet_id: outletId,
        qty_available: UNTRACKED_QTY,
        tracked_by_recipe: false,
        basis: 'untracked',
        last_synced_at: null,
      }
    }
    const row = rows[0]
    return {
      product_id: productId,
      outlet_id: outletId,
      qty_available: roundQty((normalizeQty(row.qty_on_hand) - normalizeQty(row.qty_reserved_local))),
      tracked_by_recipe: false,
      basis: 'product_alias',
      last_synced_at: row.synced_at ?? null,
    }
  }

  const itemIds = recipeComponents.map(component => component.item_id)
  const { rows } = await db.query<StockRow>(
    `SELECT item_id, qty_on_hand::text, qty_reserved_local::text, synced_at
     FROM stock_balance
     WHERE outlet_id = $1
       AND item_id = ANY($2::bigint[])`,
    [outletId, itemIds]
  )
  const rowByItem = new Map(rows.map(row => [String(row.item_id), row]))
  let availablePortions = Number.POSITIVE_INFINITY
  let lastSyncedAt = Number.POSITIVE_INFINITY

  for (const component of recipeComponents) {
    const componentQty = normalizeQty(component.component_qty)
    const yieldQty = normalizeQty(component.yield_qty)
    const conversionFactor = normalizeQty(component.conversion_factor)
    if (componentQty <= 0 || yieldQty <= 0 || conversionFactor <= 0) {
      return {
        product_id: productId,
        outlet_id: outletId,
        qty_available: 0,
        tracked_by_recipe: true,
        basis: 'recipe',
        last_synced_at: rows[0]?.synced_at ?? null,
      }
    }
    const stock = rowByItem.get(String(component.item_id))
    if (!stock) {
      return {
        product_id: productId,
        outlet_id: outletId,
        qty_available: 0,
        tracked_by_recipe: true,
        basis: 'recipe',
        last_synced_at: null,
      }
    }
    const availableBaseQty = normalizeQty(stock.qty_on_hand) - normalizeQty(stock.qty_reserved_local)
    const perPortionQty = roundQty((componentQty * conversionFactor) / yieldQty)
    if (perPortionQty <= 0) {
      return {
        product_id: productId,
        outlet_id: outletId,
        qty_available: 0,
        tracked_by_recipe: true,
        basis: 'recipe',
        last_synced_at: stock.synced_at ?? null,
      }
    }
    availablePortions = Math.min(availablePortions, availableBaseQty / perPortionQty)
    if (stock.synced_at) {
      lastSyncedAt = Math.min(lastSyncedAt, Date.parse(stock.synced_at))
    }
  }

  return {
    product_id: productId,
    outlet_id: outletId,
    qty_available: Number.isFinite(availablePortions) ? roundQty(Math.max(availablePortions, 0)) : UNTRACKED_QTY,
    tracked_by_recipe: true,
    basis: 'recipe',
    last_synced_at: Number.isFinite(lastSyncedAt) ? new Date(lastSyncedAt).toISOString() : null,
  }
}

function normalizeQty(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function roundQty(value: number): number {
  if (!Number.isFinite(value)) return value
  return Number.parseFloat(value.toFixed(QTY_SCALE))
}

export function formatQty(value: number): string {
  return roundQty(value).toFixed(QTY_SCALE)
}

async function resolveRequirementsForProduct(
  db: Queryable,
  productId: string,
  requestedQty: number
): Promise<ReservationRequirement[]> {
  const recipeComponents = await loadRecipeComponents(db, productId)
  if (recipeComponents.length === 0) {
    return [{
      itemId: productId,
      qty: roundQty(requestedQty),
      strict: false,
      productId,
      basis: 'product_alias',
    }]
  }

  return recipeComponents.map(component => {
    const componentQty = normalizeQty(component.component_qty)
    const yieldQty = normalizeQty(component.yield_qty)
    const conversionFactor = normalizeQty(component.conversion_factor)
    if (componentQty <= 0 || yieldQty <= 0 || conversionFactor <= 0) {
      throw new Error(`Invalid recipe conversion for product ${productId} item ${component.item_id}`)
    }
    return {
      itemId: component.item_id,
      qty: roundQty((requestedQty * componentQty * conversionFactor) / yieldQty),
      strict: true,
      productId,
      basis: 'recipe' as const,
    }
  })
}

async function loadRecipeComponents(db: Queryable, productId: string): Promise<RecipeComponentRow[]> {
  const { rows } = await db.query<RecipeComponentRow>(
    `SELECT rc.item_id, rc.component_qty::text, rc.yield_qty::text, rc.conversion_factor::text
     FROM recipe r
     JOIN recipe_component rc ON rc.product_id = r.product_id
     WHERE r.product_id = $1
       AND r.status = 'active'
     ORDER BY rc.item_id`,
    [productId]
  )
  return rows
}

export function isInsufficient(available: number, required: number): boolean {
  return available + QTY_EPSILON < required
}
