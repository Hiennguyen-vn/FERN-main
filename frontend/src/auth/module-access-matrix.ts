/**
 * Config-driven module access matrix.
 *
 * Each entry maps a ModuleFamily to the roles and permissions that grant
 * visibility of that module in the sidebar / route guard.
 *
 * Source of truth: docs/authorization-business-rules.md (§4 Domain Access Matrix)
 *
 * Rules are evaluated as:
 *   access = globalBypass
 *        || user has ANY listed role
 *        || user has ANY listed permission
 *        || (outletMembership && user has at least one outlet)
 */

import type { ModuleFamily } from '@/types/shell';

export interface ModuleAccessRule {
  /** Roles that grant access (canonical + legacy aliases kept for backward compat) */
  roles: string[];
  /** Fine-grained permissions that grant access as fallback */
  permissions: string[];
  /**
   * If true, any user with at least one outlet in their scope can see the
   * module (read-floor rule from §8.6 of business rules).
   */
  outletMembership: boolean;
}

/**
 * Governance-only roles (§8.1).
 *
 * When a user's ONLY canonical roles are in this set, permission-based
 * fallback is suppressed — the backend expands admin → all permissions
 * via role_permission, but the business rules say admin is governance-only.
 * Permission fallback is only meaningful for users WITHOUT a canonical role
 * (i.e. granted fine-grained permissions directly on user_permission).
 */
export const GOVERNANCE_ONLY_ROLES = new Set(['admin']);

/**
 * Matrix aligned with docs/authorization-business-rules.md §4.
 *
 * `superadmin` is handled as a global bypass in the evaluator and is NOT
 * listed per-module — this avoids duplication and guarantees superadmin
 * always passes every check.
 */
export const MODULE_ACCESS_MATRIX: Record<ModuleFamily, ModuleAccessRule> = {
  // ── Core ────────────────────────────────────────────────────────
  home: {
    roles: ['admin', 'region_manager', 'outlet_manager'],
    permissions: [],
    outletMembership: false,
  },

  // §5.3 — Sales write: outlet_manager, staff
  pos: {
    roles: ['outlet_manager', 'staff'],
    permissions: ['sales.order.write'],
    outletMembership: false,
  },

  // §5.2 — Catalog read: any outlet member; mutate: region_manager
  catalog: {
    roles: ['region_manager'],
    permissions: ['product.catalog.write'],
    outletMembership: true, // read-floor: any outlet member can browse catalog
  },

  // ── Operations ─────────────────────────────────────────────────
  // §5.5 — Inventory write: outlet_manager; read: outlet membership
  inventory: {
    roles: ['outlet_manager'],
    permissions: ['inventory.write'],
    outletMembership: true, // read-floor
  },

  // §5.4 — Procurement write: outlet_manager, procurement; approve: outlet_manager
  procurement: {
    roles: ['outlet_manager', 'procurement'],
    permissions: ['purchase.write', 'purchase.approve'],
    outletMembership: false,
  },

  // ── Finance & People ───────────────────────────────────────────
  // §5.6 — Finance write: finance, outlet_manager; read: + region_manager
  finance: {
    roles: ['finance', 'outlet_manager', 'region_manager'],
    permissions: [],
    outletMembership: false,
  },

  // §5.8 — HR schedule/contracts: hr, outlet_manager
  hr: {
    roles: ['hr', 'outlet_manager'],
    permissions: ['hr.schedule'],
    outletMembership: false,
  },

  // §5.8 + §5.7 — Workforce/scheduling share HR access
  workforce: {
    roles: ['hr', 'outlet_manager'],
    permissions: ['hr.schedule'],
    outletMembership: false,
  },

  scheduling: {
    roles: ['hr', 'outlet_manager'],
    permissions: ['hr.schedule'],
    outletMembership: false,
  },

  // ── Organization ───────────────────────────────────────────────
  // §5.1 — Org read: admin, region_manager; mutate: admin
  org: {
    roles: ['admin', 'region_manager'],
    permissions: [],
    outletMembership: false,
  },

  // Regional ops follows region_manager + admin
  'regional-ops': {
    roles: ['admin', 'region_manager'],
    permissions: [],
    outletMembership: false,
  },

  settings: {
    roles: ['admin'],
    permissions: [],
    outletMembership: false,
  },

  // ── Insights ───────────────────────────────────────────────────
  // §5.10 — Reports: region_manager, outlet_manager, finance, + outlet membership
  reports: {
    roles: ['region_manager', 'outlet_manager', 'finance'],
    permissions: [],
    outletMembership: true, // read-floor
  },

  // §5.9 — Audit read: admin, region_manager only
  audit: {
    roles: ['admin', 'region_manager'],
    permissions: [],
    outletMembership: false,
  },

  // ── Administration ─────────────────────────────────────────────
  // IAM governance: admin only (+ permission fallback)
  iam: {
    roles: ['admin'],
    permissions: ['auth.user.write', 'auth.role.write'],
    outletMembership: false,
  },

  // ── Customer ───────────────────────────────────────────────────
  // §5.3 — CRM/Promotions follow sales scoping
  crm: {
    roles: ['outlet_manager', 'staff'],
    permissions: ['sales.order.write'],
    outletMembership: false,
  },

  promotions: {
    roles: ['outlet_manager', 'staff'],
    permissions: ['sales.order.write'],
    outletMembership: false,
  },
};

/**
 * Legacy role aliases → canonical role.
 * Aligned with docs/authorization-business-rules.md §3.
 */
export const LEGACY_ROLE_ALIASES: Record<string, string> = {
  cashier: 'staff',
  staff_pos: 'staff',
  procurement_officer: 'procurement',
  hr_manager: 'hr',
  finance_manager: 'finance',
  finance_approver: 'finance',
  regional_finance: 'finance',
  accountant: 'finance',
  regional_manager: 'region_manager',
  product_manager: 'region_manager',
  system_admin: 'admin',
  technical_admin: 'admin',
};
