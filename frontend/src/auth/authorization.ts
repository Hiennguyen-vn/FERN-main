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

export function hasModuleAccess(session: AuthSession | null, family: ModuleFamily) {
  if (!session) {
    return false;
  }

  const roles = collectValues(session.rolesByOutlet);
  const permissions = collectValues(session.permissionsByOutlet);
  const outletScope = new Set([
    ...Object.keys(session.rolesByOutlet ?? {}),
    ...Object.keys(session.permissionsByOutlet ?? {}),
  ].filter(Boolean));

  const isAdmin = hasAnyValue(roles, [...ADMIN_ROLES]);
  const hasOutletScope = outletScope.size > 0;

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
    case 'audit':
      return isAdmin;
    case 'hr':
    case 'workforce':
    case 'scheduling':
      return isAdmin || hasAnyValue(permissions, ['hr.schedule']) || hasAnyValue(roles, ['outlet_manager']) || hasOutletScope;
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
