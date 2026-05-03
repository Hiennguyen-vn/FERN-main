import { fernClient } from '../upstream/fern-client.js'
import { pool } from '../db/pool.js'
import { logger } from '../lib/logger.js'

const INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null

export async function anchorClock(): Promise<void> {
  try {
    const resp = await fernClient.get('/api/v1/sync/manifest')
    const serverTime = resp.data?.serverTime ?? resp.data?.server_time
    const serverTimeMs = serverTime ? Date.parse(serverTime) : null
    const upstreamMenuVersion = Number(resp.data?.menuVersion ?? resp.data?.menu_version ?? 0)
    const upstreamRecipeVersion = Number(resp.data?.recipeVersion ?? resp.data?.recipe_version ?? 0)
    const upstreamStockVersion = Number(resp.data?.stockVersion ?? resp.data?.stock_version ?? 0)
    const anchor = {
      server_time_ms: Number.isFinite(serverTimeMs) ? serverTimeMs : null,
      captured_at_ms: Date.now(),
      upstream_menu_version: Number.isFinite(upstreamMenuVersion) && upstreamMenuVersion > 0 ? upstreamMenuVersion : null,
      upstream_recipe_version: Number.isFinite(upstreamRecipeVersion) && upstreamRecipeVersion > 0 ? upstreamRecipeVersion : null,
      upstream_stock_version: Number.isFinite(upstreamStockVersion) && upstreamStockVersion > 0 ? upstreamStockVersion : null,
    }
    await pool.query(
      `INSERT INTO device_meta (key, value, updated_at)
       VALUES ('clock_anchor', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(anchor)]
    )
    if (anchor.upstream_menu_version != null) {
      await pool.query(
        `UPDATE device_meta
         SET updated_at = NOW()
         WHERE key IN ('menu_version', 'catalog_cursor')
           AND (value->>'version' = $1 OR value->>'cursor' = $1)`,
        [String(anchor.upstream_menu_version)]
      )
    }
    if (anchor.upstream_recipe_version != null) {
      await pool.query(
        `UPDATE device_meta
         SET updated_at = NOW()
         WHERE key = 'recipe_cursor'
           AND value->>'cursor' = $1`,
        [String(anchor.upstream_recipe_version)]
      )
    }
  } catch (e) {
    logger.debug({ err: String(e) }, 'clock anchor failed (likely offline)')
  }
}

export function startClockAnchor(): void {
  if (timer) return
  anchorClock()
  timer = setInterval(anchorClock, INTERVAL_MS)
}

export function stopClockAnchor(): void {
  if (timer) { clearInterval(timer); timer = null }
}
