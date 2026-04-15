import type { AuthSession } from '@/api/fern-api';
import type { ModuleFamily } from '@/types/shell';
import {
  GOVERNANCE_ONLY_ROLES,
  LEGACY_ROLE_ALIASES,
  MODULE_ACCESS_MATRIX,
} from '@/auth/module-access-matrix';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectValues(groups: Record<string, string[]> | undefined) {
  const values = new Set<string>();
  for (const items of Object.values(groups ?? {})) {
    for (const item of items ?? []) {
      const normalized = String(item ?? '').trim();
      if (normalized) {
        values.add(normalized);
      }
    }
  }
  return values;
}

/**
 * Resolve legacy role codes to their canonical names so the matrix only
 * needs to list canonical roles.
 */
function resolveCanonicalRoles(raw: Set<string>): Set<string> {
  const canonical = new Set<string>();
  for (const role of raw) {
    canonical.add(LEGACY_ROLE_ALIASES[role] ?? role);
  }
  return canonical;
}

function hasAny(values: Set<string>, candidates: string[]) {
  return candidates.some((c) => values.has(c));
}

// ---------------------------------------------------------------------------
// Access state (cached per call-site, cheap to recompute)
// ---------------------------------------------------------------------------

function getAccessState(session: AuthSession | null) {
  const rawRoles = collectValues(session?.rolesByOutlet);
  const roles = resolveCanonicalRoles(rawRoles);
  const permissions = collectValues(session?.permissionsByOutlet);
  const outletScope = new Set(
    [
      ...Object.keys(session?.rolesByOutlet ?? {}),
      ...Object.keys(session?.permissionsByOutlet ?? {}),
    ].filter(Boolean),
  );

  // §8.1 — When user's only canonical roles are governance-only (e.g. admin),
  // suppress permission fallback. The backend expands admin → all permissions
  // via role_permission, but business rules restrict admin to governance.
  const isGovernanceOnly =
    roles.size > 0 &&
    [...roles].every((r) => GOVERNANCE_ONLY_ROLES.has(r));

  return {
    roles,
    permissions,
    outletScope,
    isSuperadmin: roles.has('superadmin'),
    isAdmin: roles.has('admin') || roles.has('superadmin'),
    isGovernanceOnly,
    hasOutletScope: outletScope.size > 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isAdminSession(session: AuthSession | null) {
  return getAccessState(session).isAdmin;
}

export function isSuperadminSession(session: AuthSession | null) {
  return getAccessState(session).isSuperadmin;
}

/**
 * Matrix-driven module access check.
 *
 * Evaluation order:
 * 1. superadmin → always granted (global bypass)
 * 2. user holds any canonical role listed in the rule
 * 3. user holds any permission listed in the rule
 * 4. outletMembership flag + user has ≥1 outlet in scope
 */
export function hasModuleAccess(session: AuthSession | null, family: ModuleFamily): boolean {
  if (!session) return false;

  const { roles, permissions, isSuperadmin, isGovernanceOnly, hasOutletScope } =
    getAccessState(session);

  // §6 — superadmin global bypass
  if (isSuperadmin) return true;

  const rule = MODULE_ACCESS_MATRIX[family];
  if (!rule) return false;

  // Step 1: role-based check
  if (rule.roles.length > 0 && hasAny(roles, rule.roles)) return true;

  // Step 2: permission fallback — suppressed for governance-only users (§8.1)
  // Backend expands admin role → all permissions via role_permission table,
  // but business rules say admin is governance-only with no business ops.
  if (!isGovernanceOnly && rule.permissions.length > 0 && hasAny(permissions, rule.permissions)) {
    return true;
  }

  // Step 3: outlet membership read floor
  if (rule.outletMembership && hasOutletScope) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Domain-specific convenience checks (used by individual modules)
// ---------------------------------------------------------------------------

export function hasFinanceWorkspaceAccess(session: AuthSession | null) {
  return hasModuleAccess(session, 'finance');
}

export function hasHrOperationsAccess(session: AuthSession | null) {
  return hasModuleAccess(session, 'hr');
}

export function hasHrCompensationAccess(session: AuthSession | null) {
  if (!session) return false;
  const { roles, isSuperadmin } = getAccessState(session);
  // Only superadmin, finance (approve), hr (prepare)
  return isSuperadmin || hasAny(roles, ['finance', 'hr']);
}

export function hasSalesOrderQueueAccess(session: AuthSession | null) {
  return hasModuleAccess(session, 'pos');
}
