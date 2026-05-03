import type { FastifyInstance } from 'fastify'
import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { getProductAvailability } from '../services/inventory-engine.js'

export function registerCatalogRoutes(app: FastifyInstance): void {
  async function buildMenu(outletId: number | string) {
    const { rows: products } = await pool.query<any>(
      `SELECT p.id, p.sku AS product_code, p.name AS product_name,
              CASE WHEN p.is_active THEN 'active' ELSE 'inactive' END AS product_status,
              COALESCE(pp.price_cents, 0) AS price_cents,
              COALESCE(pp.tax_basis_points, 0) AS tax_basis_points,
              p.category_id, p.category_name
       FROM product p
       LEFT JOIN LATERAL (
         SELECT price_cents, tax_basis_points
         FROM product_price pp
         WHERE pp.product_id = p.id
           AND pp.outlet_id = $1
           AND pp.effective_from <= NOW()
           AND (pp.effective_to IS NULL OR pp.effective_to > NOW())
         ORDER BY pp.effective_from DESC
         LIMIT 1
       ) pp ON TRUE
       WHERE p.is_active = true
       ORDER BY p.category_id NULLS LAST, p.name`,
      [outletId]
    )

    const productIdStrs = products.map(product => String(product.id))
    const { rows: variantRows } = await pool.query<any>(
      `SELECT id::text, product_id::text, code, name, price_modifier_type, price_modifier_value::text, display_order, is_active
       FROM product_variant
       WHERE product_id = ANY($1::text[]::bigint[])
       ORDER BY product_id, display_order, id`,
      [productIdStrs.length > 0 ? productIdStrs : ['0']]
    )
    const { rows: groupRows } = await pool.query<any>(
      `SELECT pmg.product_id::text, pmg.modifier_group_id::text, pmg.is_required, pmg.display_order,
              mg.code AS group_code, mg.name AS group_name, mg.selection_type, mg.min_selections, mg.max_selections, mg.is_active
       FROM product_modifier_group pmg
       JOIN modifier_group mg ON mg.id = pmg.modifier_group_id
       WHERE pmg.product_id = ANY($1::text[]::bigint[])
       ORDER BY pmg.product_id, pmg.display_order, pmg.modifier_group_id`,
      [productIdStrs.length > 0 ? productIdStrs : ['0']]
    )
    const groupIdStrs = [...new Set(groupRows.map((row: any) => String(row.modifier_group_id)))]
    const { rows: optionRows } = await pool.query<any>(
      `SELECT id::text, modifier_group_id::text, code, name, price_adjustment::text, display_order, is_active
       FROM modifier_option
       WHERE modifier_group_id = ANY($1::text[]::bigint[])
       ORDER BY modifier_group_id, display_order, id`,
      [groupIdStrs.length > 0 ? groupIdStrs : ['0']]
    )

    const variantsByProduct = new Map<string, any[]>()
    for (const row of variantRows) {
      const pid = String(row.product_id)
      if (!variantsByProduct.has(pid)) variantsByProduct.set(pid, [])
      variantsByProduct.get(pid)!.push({
        id: String(row.id),
        code: row.code,
        name: row.name,
        priceModifierType: row.price_modifier_type,
        priceModifierValue: row.price_modifier_value,
        displayOrder: Number(row.display_order),
        isActive: Boolean(row.is_active),
      })
    }

    const optionsByGroup = new Map<string, any[]>()
    for (const row of optionRows) {
      const gid = String(row.modifier_group_id)
      if (!optionsByGroup.has(gid)) optionsByGroup.set(gid, [])
      optionsByGroup.get(gid)!.push({
        id: String(row.id),
        code: row.code,
        name: row.name,
        priceAdjustment: row.price_adjustment,
        displayOrder: Number(row.display_order),
        isActive: Boolean(row.is_active),
      })
    }

    const groupsByProduct = new Map<string, any[]>()
    for (const row of groupRows) {
      const pid = String(row.product_id)
      if (!groupsByProduct.has(pid)) groupsByProduct.set(pid, [])
      groupsByProduct.get(pid)!.push({
        id: String(row.modifier_group_id),
        code: row.group_code,
        name: row.group_name,
        selectionType: row.selection_type,
        minSelections: Number(row.min_selections),
        maxSelections: Number(row.max_selections),
        isRequired: Boolean(row.is_required),
        displayOrder: Number(row.display_order),
        isActive: Boolean(row.is_active),
        options: optionsByGroup.get(String(row.modifier_group_id)) ?? [],
      })
    }

    const categoryNames = new Map<string, string>()
    const byCategory = new Map<string, any[]>()
    for (const product of products) {
      const key = product.category_id ? String(product.category_id) : '__none__'
      if (product.category_name) categoryNames.set(key, product.category_name)
      if (!byCategory.has(key)) byCategory.set(key, [])
      const pid = String(product.id)
      byCategory.get(key)!.push({
        id: pid,
        productId: pid,
        productCode: product.product_code ?? '',
        productName: product.product_name,
        productStatus: product.product_status,
        displayOrder: 0,
        isActive: true,
        priceCents: Number(product.price_cents ?? 0),
        taxBasisPoints: Number(product.tax_basis_points ?? 0),
        variants: variantsByProduct.get(pid) ?? [],
        modifierGroups: groupsByProduct.get(pid) ?? [],
      })
    }
    const categories = [...byCategory.entries()].map(([catKey, items], idx) => ({
      id: catKey === '__none__' ? '0' : catKey,
      code: catKey === '__none__' ? 'DEFAULT' : `CAT-${catKey}`,
      name: categoryNames.get(catKey) ?? (catKey !== '__none__' ? `Cat ${catKey}` : 'All'),
      displayOrder: idx,
      items,
    }))
    return {
      id: String(outletId),
      code: `OUTLET-${outletId}`,
      name: `Outlet ${outletId} menu`,
      description: null,
      status: 'active',
      scopeType: 'outlet',
      scopeId: String(outletId),
      categories,
    }
  }

  app.get('/api/v1/product/menus', async (req, reply) => {
    const outletId = String((req.query as any)?.outletId ?? config.OUTLET_ID)
    return reply.send([await buildMenu(outletId)])
  })

  app.get('/api/v1/product/menus/:menuId', async (req, reply) => {
    const outletId = String((req.query as any)?.outletId ?? config.OUTLET_ID)
    return reply.send(await buildMenu(outletId))
  })

  const localMenu = async (req: any, reply: any) => {
    const outletId = String((req.query as any)?.outlet_id ?? (req.query as any)?.outletId ?? config.OUTLET_ID)
    return reply.send(await buildMenu(outletId))
  }
  app.get('/api/v1/local/catalog/menu', localMenu)
  app.get('/api/local/catalog/menu', localMenu)

  /** FERN-compatible price list endpoint. */
  app.get('/api/v1/product/prices', async (req, reply) => {
    const outletId = String((req.query as any)?.outletId ?? config.OUTLET_ID)
    const { rows } = await pool.query<any>(
      `SELECT product_id, outlet_id, price_cents, effective_from, effective_to
       FROM product_price
       WHERE outlet_id = $1
       ORDER BY product_id, effective_from DESC`,
      [outletId]
    )
    return reply.send(rows.map(r => ({
      id: `${r.product_id}-${r.outlet_id}-${r.effective_from}`,
      productId: String(r.product_id),
      outletId: String(r.outlet_id),
      priceValue: Number(r.price_cents),
      priceAmount: Number(r.price_cents),
      effectiveFrom: r.effective_from ? new Date(r.effective_from).toISOString() : null,
      effectiveTo: r.effective_to ? new Date(r.effective_to).toISOString() : null,
    })))
  })

  /** List active menu items with current price for the outlet (simple shape). */
  app.get('/api/v1/menus', async (req, reply) => {
    const outletId = String((req.query as any)?.outlet_id ?? config.OUTLET_ID)
    const { rows } = await pool.query(
      `SELECT p.id, p.sku, p.name, p.category_id, p.image_url,
              (
                SELECT pp.price_cents
                FROM product_price pp
                WHERE pp.product_id = p.id AND pp.outlet_id = $1
                  AND pp.effective_from <= NOW()
                  AND (pp.effective_to IS NULL OR pp.effective_to > NOW())
                ORDER BY pp.effective_from DESC
                LIMIT 1
              ) AS price_cents
       FROM product p
       WHERE p.is_active = true
       ORDER BY p.name`,
      [outletId]
    )
    return reply.send(rows)
  })

  /** Raw price rows for the outlet (debug/inspection). */
  app.get('/api/v1/prices', async (req, reply) => {
    const outletId = String((req.query as any)?.outlet_id ?? config.OUTLET_ID)
    const { rows } = await pool.query(
      `SELECT product_id, outlet_id, price_cents, effective_from, effective_to
       FROM product_price
       WHERE outlet_id = $1
       ORDER BY product_id, effective_from DESC`,
      [outletId]
    )
    return reply.send(rows)
  })

  /** Stock balance snapshot for the outlet — paginated + item name/uom join for waste UI. */
  app.get('/api/v1/inventory/stock-balances', async (req, reply) => {
    const q = req.query as any
    const outletId = String(q?.outlet_id ?? q?.outletId ?? config.OUTLET_ID)
    const { rows } = await pool.query(
      `SELECT sb.item_id, sb.outlet_id, sb.qty_on_hand, sb.qty_reserved_local,
              sb.last_movement_at, sb.synced_at,
              COALESCE(i.name, 'Item ' || sb.item_id) AS item_name,
              COALESCE(i.unit, '') AS base_uom_code
       FROM stock_balance sb
       LEFT JOIN item i ON i.id = sb.item_id
       WHERE sb.outlet_id = $1
       ORDER BY i.name NULLS LAST`,
      [outletId]
    )
    const content = rows.map(r => ({
      itemId: String(r.item_id),
      outletId: String(r.outlet_id),
      itemName: r.item_name,
      baseUomCode: r.base_uom_code,
      qtyOnHand: String(r.qty_on_hand),
      qtyReservedLocal: String(r.qty_reserved_local),
      lastMovementAt: r.last_movement_at ?? null,
      syncedAt: r.synced_at ?? null,
      unitCost: null,
    }))
    // Support both paginated format (waste UI) and raw array (legacy)
    if (q?.limit || q?.outletId) {
      return reply.send({ content, totalElements: content.length, page: 0, size: content.length })
    }
    return reply.send(rows)
  })

  app.get('/api/v1/inventory/stock-balances/:itemId', async (req, reply) => {
    const outletId = String((req.query as any)?.outlet_id ?? config.OUTLET_ID)
    const itemId = String((req.params as any)?.itemId)
    const { rows } = await pool.query(
      `SELECT item_id, outlet_id, qty_on_hand, qty_reserved_local, last_movement_at, synced_at
       FROM stock_balance
       WHERE outlet_id = $1 AND item_id = $2
       LIMIT 1`,
      [outletId, itemId]
    )
    if (rows.length === 0) return reply.code(404).send({ error: 'stock_not_found' })
    return reply.send(rows[0])
  })

  app.get('/api/v1/inventory/products/:productId/availability', async (req, reply) => {
    const outletId = String((req.query as any)?.outlet_id ?? config.OUTLET_ID)
    const productId = String((req.params as any)?.productId)
    const availability = await getProductAvailability(pool, outletId, productId)
    return reply.send(availability)
  })

  const localAvailability = async (req: any, reply: any) => {
    const outletId = String((req.query as any)?.outlet_id ?? (req.query as any)?.outletId ?? config.OUTLET_ID)
    const productId = String((req.query as any)?.product_id ?? (req.query as any)?.productId)
    const availability = await getProductAvailability(pool, outletId, productId)
    return reply.send(availability)
  }
  app.get('/api/v1/local/inventory/availability', localAvailability)
  app.get('/api/local/inventory/availability', localAvailability)

}
