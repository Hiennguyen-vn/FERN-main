import type { AuthSession } from '@/api/fern-api';
import type { ModuleFamily } from '@/types/shell';

const ADMIN_ROLES = new Set(['admin', 'superadmin']);

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

function hasAnyValue(values: Set<string>, candidates: string[]) {
  return candidates.some((candidate) => values.has(candidate));
}

function getAccessState(session: AuthSession | null) {
  const roles = collectValues(session?.rolesByOutlet);
  const permissions = collectValues(session?.permissionsByOutlet);
  const outletScope = new Set([
    ...Object.keys(session?.rolesByOutlet ?? {}),
    ...Object.keys(session?.permissionsByOutlet ?? {}),
  ].filter(Boolean));

  return {
    roles,
    permissions,
    outletScope,
    isAdmin: hasAnyValue(roles, [...ADMIN_ROLES]),
    hasOutletScope: outletScope.size > 0,
  };
}

export function isAdminSession(session: AuthSession | null) {
  return getAccessState(session).isAdmin;
}

export function hasFinanceWorkspaceAccess(session: AuthSession | null) {
  return getAccessState(session).isAdmin;
}

export function hasHrOperationsAccess(session: AuthSession | null) {
  if (!session) {
    return false;
  }

  const { isAdmin, permissions, roles, hasOutletScope } = getAccessState(session);
  return isAdmin
    || hasAnyValue(permissions, ['hr.schedule', 'hr.contract.write', 'hr.contract.read', 'payroll.write', 'payroll.read'])
    || hasAnyValue(roles, ['outlet_manager', 'regional_manager', 'hr_manager'])
    || hasOutletScope;
}

export function hasHrCompensationAccess(session: AuthSession | null) {
  return getAccessState(session).isAdmin;
}

export function hasSalesOrderQueueAccess(session: AuthSession | null) {
  if (!session) {
    return false;
  }
  const { isAdmin, permissions } = getAccessState(session);
  return isAdmin || hasAnyValue(permissions, ['sales.order.write']);
}

export function hasModuleAccess(session: AuthSession | null, family: ModuleFamily) {
  if (!session) {
    return false;
  }

  const { roles, permissions, isAdmin, hasOutletScope } = getAccessState(session);

  switch (family) {
    case 'home':
      return true;
    case 'pos':
    case 'crm':
    case 'promotions':
      return isAdmin || hasAnyValue(permissions, ['sales.order.write']) || hasOutletScope;
    case 'catalog':
      return isAdmin || hasAnyValue(permissions, ['product.catalog.write']) || hasOutletScope;
    case 'inventory':
      return isAdmin || hasAnyValue(permissions, ['inventory.write']) || hasAnyValue(roles, ['outlet_manager']) || hasOutletScope;
    case 'procurement':
      return isAdmin || hasAnyValue(permissions, ['purchase.write', 'purchase.approve']) || hasAnyValue(roles, ['outlet_manager']) || hasOutletScope;
    case 'finance':
      return hasFinanceWorkspaceAccess(session);
    case 'audit':
      return isAdmin || hasAnyValue(permissions, ['audit.read']) || hasAnyValue(roles, ['accountant', 'finance_manager']);
    case 'hr':
      return hasHrOperationsAccess(session);
    case 'workforce':
    case 'scheduling':
      return hasHrOperationsAccess(session);
    case 'iam':
      return isAdmin || hasAnyValue(permissions, ['auth.user.write', 'auth.role.write']);
    case 'org':
    case 'settings':
    case 'reports':
    case 'regional-ops':
      return isAdmin || hasOutletScope;
    default:
      return false;
  }
}
