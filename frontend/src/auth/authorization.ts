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

function hasCollectedValues(groups: Record<string, string[]> | undefined) {
  return collectValues(groups).size > 0;
}

/** Roles map for routing/UI — aligned with sidebar matrix and route guards. */
function normalizeOutletRolesList(list: string[] | undefined): string[] {
  const out: string[] = [];
  for (const item of list ?? []) {
    const normalized = String(item ?? '').trim();
    if (!normalized) continue;
    out.push(normalized);
  }
  return out;
}

function normalizeLegacyOutletRolesList(list: string[] | undefined): string[] {
  const out: string[] = [];
  for (const item of list ?? []) {
    const normalized = String(item ?? '').trim();
    if (!normalized) continue;
    out.push(LEGACY_ROLE_ALIASES[normalized] ?? normalized);
  }
  return out;
}

export function effectiveRolesByOutletRecord(session: AuthSession | null | undefined): Record<string, string[]> {
  if (!session) return {};
  if (hasCollectedValues(session.canonicalRolesByOutlet)) {
    const canonical = session.canonicalRolesByOutlet ?? {};
    return Object.fromEntries(
      Object.entries(canonical).map(([id, list]) => [id, normalizeOutletRolesList(list)]),
    );
  }
  const raw = session.rolesByOutlet ?? {};
  return Object.fromEntries(
    Object.entries(raw).map(([id, list]) => [id, normalizeLegacyOutletRolesList(list)]),
  );
}

/** Flattened canonical (or legacy-normalized) role codes for the session. */
export function sessionRolesSet(session: AuthSession | null | undefined): Set<string> {
  return collectValues(effectiveRolesByOutletRecord(session));
}

function hasAny(values: Set<string>, candidates: string[]) {
  return candidates.some((c) => values.has(c));
}

// ---------------------------------------------------------------------------
// Access state (cached per call-site, cheap to recompute)
// ---------------------------------------------------------------------------

function getAccessState(session: AuthSession | null) {
  const roles = sessionRolesSet(session);
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
  const kitchenOnlyPermissions = new Set(['kitchen.read', 'kitchen.write']);
  const isKitchenOnly =
    (roles.has('kitchen_staff') || permissions.has('kitchen.read')) &&
    [...roles].every((r) => r === 'kitchen_staff') &&
    [...permissions].every((p) => kitchenOnlyPermissions.has(p));

  return {
    roles,
    permissions,
    outletScope,
    isSuperadmin: roles.has('superadmin'),
    isAdmin: roles.has('admin') || roles.has('superadmin'),
    isGovernanceOnly,
    isKitchenOnly,
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

  const { roles, permissions, isSuperadmin, isGovernanceOnly, isKitchenOnly, hasOutletScope } =
    getAccessState(session);

  // §6 — superadmin global bypass
  if (isSuperadmin) return true;

  if (isKitchenOnly) return family === 'kitchen';

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

export function hasCrmReadAccess(session: AuthSession | null) {
  return hasModuleAccess(session, 'crm');
}

export function hasPosOrderingTableAccess(session: AuthSession | null) {
  return hasSalesOrderQueueAccess(session);
}

export function hasCatalogMutationAccess(session: AuthSession | null) {
  if (!session) return false;

  const { roles, permissions, isSuperadmin, isGovernanceOnly } = getAccessState(session);

  if (isSuperadmin) return true;
  if (roles.has('region_manager')) return true;

  return !isGovernanceOnly && permissions.has('product.catalog.write');
}

export function hasIamUserManagementAccess(session: AuthSession | null) {
  if (!session) return false;

  const { roles, permissions, isSuperadmin, isGovernanceOnly } = getAccessState(session);

  if (isSuperadmin) return true;
  if (roles.has('admin')) return true;

  return !isGovernanceOnly && permissions.has('auth.user.write');
}

export function hasIamRoleManagementAccess(session: AuthSession | null) {
  if (!session) return false;

  const { roles, permissions, isSuperadmin, isGovernanceOnly } = getAccessState(session);

  if (isSuperadmin) return true;
  if (roles.has('admin')) return true;

  return !isGovernanceOnly && permissions.has('auth.role.write');
}
