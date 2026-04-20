import { useMemo } from 'react';
import type { AuthSession } from '@/api/auth-api';
import { resolveCanonicalRoles } from '@/components/finance/finance-utils';

const MANAGER_TIER = new Set(['outlet_manager', 'region_manager', 'admin', 'superadmin']);
const SELLER_ROLES = new Set(['staff', 'outlet_manager', 'admin', 'superadmin']);

export interface RoleResolution {
  roles: Set<string>;
  isManager: boolean;
  isStaffOnly: boolean;
  canSell: boolean;
}

export function resolveRolesForOutlet(session: AuthSession | null | undefined, outletId: string | null | undefined): RoleResolution {
  if (!session || !outletId) {
    return { roles: new Set(), isManager: false, isStaffOnly: false, canSell: false };
  }
  const rolesByOutlet = session.rolesByOutlet ?? {};
  const raw = rolesByOutlet[String(outletId)] ?? [];
  const canonical = resolveCanonicalRoles({ [outletId]: raw });
  const isSuperadmin = canonical.has('superadmin');
  const globalRoles = resolveCanonicalRoles(rolesByOutlet);
  const superadminAny = isSuperadmin || globalRoles.has('superadmin');
  const isManager = superadminAny || Array.from(canonical).some((r) => MANAGER_TIER.has(r));
  const canSell = superadminAny || Array.from(canonical).some((r) => SELLER_ROLES.has(r));
  const isStaffOnly = !isManager && canonical.has('staff');
  return { roles: canonical, isManager, isStaffOnly, canSell };
}

export function useRoleForOutlet(session: AuthSession | null | undefined, outletId: string | null | undefined) {
  return useMemo(() => resolveRolesForOutlet(session, outletId), [session, outletId]);
}
