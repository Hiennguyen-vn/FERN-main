import JSONBig from 'json-bigint'
import { fernClient } from '../upstream/fern-client.js'
import { pool, withTx } from '../db/pool.js'
import { logger } from '../lib/logger.js'
import { config } from '../config.js'

const JSONBigStr = JSONBig({ storeAsString: true })

const INTERVAL_MS = 5 * 60 * 1000
let timer: NodeJS.Timeout | null = null
let running = false

type RecipeComponentRow = {
  itemId: string
  itemCode?: string | null
  itemName?: string | null
  componentQty: string
  yieldQty: string
  componentUomCode: string
  itemBaseUomCode: string
  conversionFactor: string
}

type RecipeRow = {
  productId: string
  version: string
  yieldQty: string
  yieldUomCode: string
  status: string
  updatedAt: number
  components: RecipeComponentRow[]
}

async function getCursor(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: { cursor: string } }>(
    `SELECT value FROM device_meta WHERE key = $1`,
    [key]
  )
  return rows[0]?.value?.cursor ?? null
}

async function setCursor(key: string, cursor: string): Promise<void> {
  await pool.query(
    `INSERT INTO device_meta (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify({ cursor })]
  )
}

export async function pullRecipes(): Promise<void> {
  if (running) return
  running = true
  try {
    let cursor = await getCursor('recipe_cursor') ?? '0'
    let safety = 0
    while (safety++ < 50) {
      const resp = await fernClient.get('/api/v1/sync/pull/recipes', {
        params: { since: cursor, outlet_id: config.OUTLET_ID, limit: 250 },
        transformResponse: [(data: string) => data],
      })
      const body: string = resp.data
      const lines = body.split('\n').filter(line => line.trim().length > 0)
      if (lines.length === 0) break

      let lastCursor = cursor
      const recipes: RecipeRow[] = []
      for (const line of lines) {
        const row = JSONBigStr.parse(line)
        if (row.type === 'checkpoint') {
          lastCursor = String(row.cursor)
          continue
        }
        recipes.push(row as RecipeRow)
      }

      await withTx(async (client) => {
        for (const recipe of recipes) {
          const productId = String(recipe.productId)
          const updatedAt = new Date(recipe.updatedAt).toISOString()
          await client.query(
            `INSERT INTO recipe (product_id, version, yield_qty, yield_uom_code, status, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (product_id) DO UPDATE SET
               version = EXCLUDED.version,
               yield_qty = EXCLUDED.yield_qty,
               yield_uom_code = EXCLUDED.yield_uom_code,
               status = EXCLUDED.status,
               updated_at = EXCLUDED.updated_at`,
            [
              productId,
              recipe.version,
              recipe.yieldQty,
              recipe.yieldUomCode,
              recipe.status,
              updatedAt,
            ]
          )
          await client.query(`DELETE FROM recipe_component WHERE product_id = $1`, [productId])
          for (const component of recipe.components ?? []) {
            const itemId = String(component.itemId)
            await client.query(
              `INSERT INTO recipe_component (
                 product_id, item_id, item_code, item_name, component_qty, yield_qty,
                 component_uom_code, item_base_uom_code, conversion_factor, updated_at
               )
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT (product_id, item_id) DO UPDATE SET
                 item_code = EXCLUDED.item_code,
                 item_name = EXCLUDED.item_name,
                 component_qty = EXCLUDED.component_qty,
                 yield_qty = EXCLUDED.yield_qty,
                 component_uom_code = EXCLUDED.component_uom_code,
                 item_base_uom_code = EXCLUDED.item_base_uom_code,
                 conversion_factor = EXCLUDED.conversion_factor,
                 updated_at = EXCLUDED.updated_at`,
              [
                productId,
                itemId,
                component.itemCode ?? null,
                component.itemName ?? null,
                component.componentQty,
                component.yieldQty,
                component.componentUomCode,
                component.itemBaseUomCode,
                component.conversionFactor,
                updatedAt,
              ]
            )
            await client.query(
              `INSERT INTO item (id, sku, name, unit, updated_at)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (id) DO UPDATE SET
                 sku = COALESCE(EXCLUDED.sku, item.sku),
                 name = COALESCE(EXCLUDED.name, item.name),
                 unit = EXCLUDED.unit,
                 updated_at = EXCLUDED.updated_at`,
              [
                itemId,
                component.itemCode ?? null,
                component.itemName ?? `Item ${itemId}`,
                component.itemBaseUomCode,
                updatedAt,
              ]
            )
          }
        }
      })

      const nextHeader = resp.headers['x-next-cursor']
      const next = typeof nextHeader === 'string' ? nextHeader : lastCursor
      if (next === cursor) break
      cursor = next
      await setCursor('recipe_cursor', cursor)
    }
    logger.info('recipe pull complete')
  } catch (e) {
    logger.warn({ err: String(e) }, 'recipe pull failed (likely offline)')
  } finally {
    running = false
  }
}

export function startRecipePuller(): void {
  if (timer) return
  pullRecipes()
  timer = setInterval(pullRecipes, INTERVAL_MS)
}

export function stopRecipePuller(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
