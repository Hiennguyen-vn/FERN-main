/**
 * Simple SQL migration runner — applies *.sql files in migrations/ alphabetically.
 * Tracks applied versions in _schema_migrations table.
 */
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool } from './pool.js'
import { logger } from '../lib/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort()

  const { rows } = await pool.query<{ version: string }>('SELECT version FROM _schema_migrations')
  const applied = new Set(rows.map(r => r.version))

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    logger.info({ file }, 'applying migration')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO _schema_migrations (version) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      logger.error({ file, err: e }, 'migration failed')
      throw e
    } finally {
      client.release()
    }
  }
  logger.info({ count: files.length }, 'migrations applied')
}
