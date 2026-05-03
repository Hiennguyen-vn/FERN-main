import JSONBig from 'json-bigint'
import { fernClient } from '../upstream/fern-client.js'
import { pool, withTx } from '../db/pool.js'
import { logger } from '../lib/logger.js'
import { config } from '../config.js'
import { publishLocalEvent } from './local-events.js'

const JSONBigStr = JSONBig({ storeAsString: true })

const INTERVAL_MS = 5 * 60 * 1000
let timer: NodeJS.Timeout | null = null
let running = false

type MenuSnapshot = {
  outletId: string
  version: number
  products: Array<{
    id: string
    outletId: string
    code: string
    name: string
    categoryId: string
    categoryName: string
    isActive: boolean
    isAvailable: boolean
    priceCents: number
    taxBasisPoints: number
  }>
  variants: Array<{
    id: string
    productId: string
    code: string
    name: string
    priceModifierType: string
    priceModifierValue: string
    displayOrder: number
    isActive: boolean
  }>
  modifierGroups: Array<{
    id: string
    code: string
    name: string
    selectionType: string
    minSelections: number
    maxSelections: number
    displayOrder: number
    isActive: boolean
  }>
  modifierOptions: Array<{
    id: string
    modifierGroupId: string
    code: string
    name: string
    priceAdjustment: string
    displayOrder: number
    isActive: boolean
  }>
  productModifierGroups: Array<{
    productId: string
    modifierGroupId: string
    isRequired: boolean
    displayOrder: number
  }>
}

async function getMenuVersion(): Promise<number> {
  const { rows } = await pool.query<{ value: { version?: number } }>(
    `SELECT value FROM device_meta WHERE key = 'menu_version' LIMIT 1`
  )
  return Number(rows[0]?.value?.version ?? 0)
}

async function setMenuVersion(version: number): Promise<void> {
  await pool.query(
    `INSERT INTO device_meta (key, value, updated_at) VALUES ('menu_version', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ version })]
  )
  await pool.query(
    `INSERT INTO device_meta (key, value, updated_at) VALUES ('catalog_cursor', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ cursor: String(version) })]
  )
}

async function touchMenuVersion(version: number): Promise<void> {
  if (version <= 0) return
  await setMenuVersion(version)
}

export async function pullCatalog(): Promise<void> {
  if (running) return
  running = true
  try {
    const manifest = await fernClient.get<{ menuVersion: number }>('/api/v1/sync/manifest')
    const upstreamVersion = Number(manifest.data?.menuVersion ?? 0)
    const localVersion = await getMenuVersion()
    if (upstreamVersion > 0 && upstreamVersion === localVersion) {
      await touchMenuVersion(localVersion)
      return
    }

    const resp = await fernClient.get<string>('/api/v1/sync/pull/menu', {
      params: { outlet_id: config.OUTLET_ID },
      transformResponse: [(data: string) => data],  // keep raw string, parse below
    })
    const snapshot = JSONBigStr.parse(resp.data) as MenuSnapshot
    await withTx(async client => {
      for (const product of snapshot.products) {
        await client.query(
          `INSERT INTO product (id, sku, name, category_id, category_name, image_url, is_active, tax_basis_points, updated_at)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,NOW())
           ON CONFLICT (id) DO UPDATE SET
             sku = EXCLUDED.sku,
             name = EXCLUDED.name,
             category_id = EXCLUDED.category_id,
             category_name = EXCLUDED.category_name,
             is_active = EXCLUDED.is_active,
             tax_basis_points = EXCLUDED.tax_basis_points,
             updated_at = NOW()`,
          [product.id, product.code, product.name, product.categoryId, product.categoryName ?? null, product.isActive && product.isAvailable, product.taxBasisPoints]
        )
      }
      const activeProductIds = snapshot.products.map(product => product.id)
      if (activeProductIds.length > 0) {
        await client.query(
          `UPDATE product
           SET is_active = FALSE, updated_at = NOW()
           WHERE id <> ALL($1::bigint[])`,
          [activeProductIds]
        )
      }
      await client.query(`DELETE FROM product_price WHERE outlet_id = $1`, [config.OUTLET_ID])
      for (const product of snapshot.products) {
        await client.query(
          `INSERT INTO product_price (product_id, outlet_id, price_cents, effective_from, effective_to, updated_at)
           VALUES ($1,$2,$3,NOW(),NULL,NOW())
           ON CONFLICT (product_id, outlet_id, effective_from) DO NOTHING`,
          [product.id, config.OUTLET_ID, Math.round(Number(product.priceCents ?? 0))]
        )
      }

      await client.query(`DELETE FROM product_modifier_group`)
      await client.query(`DELETE FROM modifier_option`)
      await client.query(`DELETE FROM modifier_group`)
      await client.query(`DELETE FROM product_variant`)

      for (const variant of snapshot.variants) {
        await client.query(
          `INSERT INTO product_variant
            (id, product_id, code, name, price_modifier_type, price_modifier_value, display_order, is_active, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,$8,NOW())`,
          [
            variant.id,
            variant.productId,
            variant.code,
            variant.name,
            variant.priceModifierType,
            variant.priceModifierValue,
            variant.displayOrder,
            variant.isActive,
          ]
        )
      }
      for (const group of snapshot.modifierGroups) {
        await client.query(
          `INSERT INTO modifier_group
            (id, code, name, selection_type, min_selections, max_selections, is_active, display_order, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [
            group.id,
            group.code,
            group.name,
            group.selectionType,
            group.minSelections,
            group.maxSelections,
            group.isActive,
            group.displayOrder,
          ]
        )
      }
      for (const option of snapshot.modifierOptions) {
        await client.query(
          `INSERT INTO modifier_option
            (id, modifier_group_id, code, name, price_adjustment, display_order, is_active, updated_at)
           VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,NOW())`,
          [
            option.id,
            option.modifierGroupId,
            option.code,
            option.name,
            option.priceAdjustment,
            option.displayOrder,
            option.isActive,
          ]
        )
      }
      for (const assignment of snapshot.productModifierGroups) {
        await client.query(
          `INSERT INTO product_modifier_group
            (product_id, modifier_group_id, is_required, display_order, updated_at)
           VALUES ($1,$2,$3,$4,NOW())`,
          [assignment.productId, assignment.modifierGroupId, assignment.isRequired, assignment.displayOrder]
        )
      }
    })
    await setMenuVersion(snapshot.version)
    publishLocalEvent('menu.updated', {
      outlet_id: config.OUTLET_ID,
      version: snapshot.version,
      products: snapshot.products.length,
    })
    logger.info(
      {
        products: snapshot.products.length,
        variants: snapshot.variants.length,
        modifierGroups: snapshot.modifierGroups.length,
        modifierOptions: snapshot.modifierOptions.length,
      },
      'menu pull complete'
    )
  } catch (error) {
    logger.warn({ err: String(error) }, 'menu pull failed (likely offline)')
  } finally {
    running = false
  }
}

export function startCatalogPuller(): void {
  if (timer) return
  pullCatalog()
  timer = setInterval(pullCatalog, INTERVAL_MS)
}

export function stopCatalogPuller(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
