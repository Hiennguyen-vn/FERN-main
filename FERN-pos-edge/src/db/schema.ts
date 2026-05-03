import Dexie, { type Table } from 'dexie'

export interface CatalogItem {
  id: string
  outlet_id: string
  name: string
  category_id: string
  price_cents: number
  image_url: string | null
  is_available: boolean
  updated_at: number
}

export interface PriceRow {
  product_id: string
  outlet_id: string
  effective_from: number
  effective_to: number | null
  price_cents: number
}

export interface StockRow {
  item_id: string
  outlet_id: string
  qty_on_hand: string
  qty_reserved_local: string
  last_synced_at: number
}

export interface PosSessionCache {
  id: string
  outlet_id: string
  manager_id: string
  device_id?: string | null
  register_code?: string | null
  register_display_name?: string | null
  opened_by_user_id?: string | null
  opened_by_username?: string | null
  status: 'open' | 'closed'
  opened_at: number
  closed_at?: number | null
  business_date: string
  cash_float_cents: number
  note?: string | null
}

export interface SaleItemModifierLocal {
  modifier_option_id: string
  group_name?: string | null
  option_name?: string | null
  price_add_cents: number
}

export interface SaleItemLocal {
  cart_line_id?: string
  product_id: string
  product_name?: string | null
  qty: string
  unit_price_cents: number
  discount_cents: number
  line_total_cents: number
  tax_cents?: number
  variant_id?: string | null
  variant_name?: string | null
  note?: string | null
  modifier_option_ids?: string[]
  modifiers?: SaleItemModifierLocal[]
}

export interface SaleLocal {
  id: string              // Snowflake client ID (string to avoid BigInt json issues)
  outlet_id: string
  pos_session_id: string
  items: SaleItemLocal[]
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  note: string | null
  status: 'draft' | 'submitted' | 'approved' | 'paid' | 'voided'
  created_at: number
  client_occurred_at: number
  monotonic_seq: number
  oversell_warning_shown: boolean
}

export interface PaymentLocal {
  id: string
  sale_id: string
  method: 'cash'
  amount_cents: number
  paid_at: number
  transaction_ref: string | null
}

/** Singleton cart draft persisted across page reloads. id is always 1. */
export interface CartDraft {
  id: number
  outletId: string | null
  posSessionId: string | null
  items: SaleItemLocal[]
  note: string
  savedAt: number  // ms epoch
}

export interface MetaKV {
  key: string
  value: unknown
}

/** Local audit ledger — captures security-relevant cashier actions even when offline so a
 *  wiped/lost device still leaves a forensic trail once the next sync flush succeeds. */
export interface AuditLocal {
  event_id: string         // snowflake — also serves as idempotency key
  actor_user_id: number | null
  actor_username: string | null
  outlet_id: string | null
  device_id: string | null
  action: AuditAction
  target_type: string | null   // 'sale', 'session', 'product', etc.
  target_id: string | null
  payload_json: string         // stringified for Dexie BLOB-free storage
  payload_sha256: string       // stable hash so server can detect tampering on replay
  created_at_device: number    // ms epoch
  forwarded_at: number | null  // null = pending flush
}

export type AuditAction =
  | 'offline_login'
  | 'void_sale'
  | 'manual_discount'
  | 'manual_price_override'
  | 'cash_drawer_open'
  | 'shift_close_discrepancy'

// Tracks in-flight submit attempts so cart isn't cleared until agent ACKs.
// Survives browser reload; lets retry use the same idempotency key + client_sale_id.
export interface PendingSubmit {
  client_sale_id: string
  idem_key: string
  endpoint: 'submit' | 'approve' | 'pay'
  payload_json: string
  created_at_device: number
  attempts: number
  last_error?: string | null
}

// Persisted credential cache used for offline login. Hash is PBKDF2-SHA256 today;
// when the edge moves to Tauri this row should be migrated to the OS keychain
// (tauri-plugin-keyring) and this table dropped — keep `user_id` PK identical so
// the swap is a no-op for callers.
export interface DeviceCredential {
  user_id: number
  username: string
  password_hash: string        // pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>
  scopes: string               // JSON array — keep as string to avoid Dexie indexing arrays
  outlet_ids: string           // JSON array of outlet ids
  display_name: string | null
  cached_at: number            // ms epoch
  expires_at: number           // ms epoch (cached_at + 24h)
  last_offline_login_at: number | null
}

export class PosEdgeDB extends Dexie {
  catalog!: Table<CatalogItem, string>
  prices!: Table<PriceRow, [string, string]>
  stock!: Table<StockRow, [string, string]>
  sessions!: Table<PosSessionCache, string>
  sales!: Table<SaleLocal, string>
  payments!: Table<PaymentLocal, string>
  meta!: Table<MetaKV, string>
  deviceCredential!: Table<DeviceCredential, number>
  cartDraft!: Table<CartDraft, number>
  pendingSubmit!: Table<PendingSubmit, string>
  auditLocal!: Table<AuditLocal, string>

  constructor() {
    super('fern-pos-edge')
    this.version(1).stores({
      catalog:  'id, outlet_id, category_id, updated_at',
      prices:   '[product_id+outlet_id], effective_from',
      stock:    '[item_id+outlet_id], last_synced_at',
      sessions: 'id, outlet_id, status',
      sales:    'id, pos_session_id, status, created_at',
      payments: 'id, sale_id',
      outbox:   'event_id, status, created_at, idempotency_key',
      meta:     'key',
    })
    this.version(2).stores({
      catalog:  'id, outlet_id, category_id, updated_at',
      prices:   '[product_id+outlet_id], effective_from',
      stock:    '[item_id+outlet_id], last_synced_at',
      sessions: 'id, outlet_id, status',
      sales:    'id, pos_session_id, status, created_at',
      payments: 'id, sale_id',
      outbox:   'event_id, status, created_at, idempotency_key',
      meta:     'key',
      deviceCredential: 'user_id, username, expires_at',
    })
    // v3: drop outbox (dead — agent writes to Postgres local, not Dexie),
    //     add cartDraft for cross-reload cart persistence
    this.version(3).stores({
      catalog:  'id, outlet_id, category_id, updated_at',
      prices:   '[product_id+outlet_id], effective_from',
      stock:    '[item_id+outlet_id], last_synced_at',
      sessions: 'id, outlet_id, status',
      sales:    'id, pos_session_id, status, created_at',
      payments: 'id, sale_id',
      outbox:   null,   // dropped
      meta:     'key',
      deviceCredential: 'user_id, username, expires_at',
      cartDraft: 'id',
    })
    // v4: add pendingSubmit — tracks in-flight HTTP submit/approve/pay so
    //     a retry after agent crash uses the same client_sale_id + idem key.
    this.version(4).stores({
      catalog:  'id, outlet_id, category_id, updated_at',
      prices:   '[product_id+outlet_id], effective_from',
      stock:    '[item_id+outlet_id], last_synced_at',
      sessions: 'id, outlet_id, status',
      sales:    'id, pos_session_id, status, created_at',
      payments: 'id, sale_id',
      meta:     'key',
      deviceCredential: 'user_id, username, expires_at',
      cartDraft: 'id',
      pendingSubmit: 'client_sale_id, endpoint, created_at_device',
    })
    // v5: add auditLocal for forensic trail of cashier actions (Gap 7).
    this.version(5).stores({
      catalog:  'id, outlet_id, category_id, updated_at',
      prices:   '[product_id+outlet_id], effective_from',
      stock:    '[item_id+outlet_id], last_synced_at',
      sessions: 'id, outlet_id, status',
      sales:    'id, pos_session_id, status, created_at',
      payments: 'id, sale_id',
      meta:     'key',
      deviceCredential: 'user_id, username, expires_at',
      cartDraft: 'id',
      pendingSubmit: 'client_sale_id, endpoint, created_at_device',
      auditLocal: 'event_id, action, forwarded_at, created_at_device',
    })
  }
}

export const db = new PosEdgeDB()
