import { useMemo } from 'react';
import type { AuthSession } from '@/api/auth-api';
import { effectiveRolesByOutletRecord } from '@/auth/authorization';

const MANAGER_TIER = new Set(['outlet_manager', 'region_manager', 'admin', 'superadmin']);
const SELLER_ROLES = new Set(['staff', 'outlet_manager', 'admin', 'superadmin']);

export interface RoleResolution {
  roles: Set<string>;
  isManager: boolean;
  isStaffOnly: boolean;
  canSell: boolean;
}

function emptyResolution(): RoleResolution {
  return { roles: new Set(), isManager: false, isStaffOnly: false, canSell: false };
}

function roleSetForOutlet(map: Record<string, string[]>, outletId: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const add = (code: string) => {
    const t = String(code ?? '').trim();
    if (t) out.add(t);
  };
  if (outletId) {
    for (const r of map[String(outletId)] ?? []) add(r);
  } else {
    for (const list of Object.values(map)) {
      for (const r of list ?? []) add(r);
    }
  }
  return out;
}

export function resolveRolesForOutlet(session: AuthSession | null | undefined, outletId: string | null | undefined): RoleResolution {
  if (!session) {
    return emptyResolution();
  }
  const map = effectiveRolesByOutletRecord(session);
  const globalRoles = roleSetForOutlet(map, null);

  if (!outletId) {
    const isSuperadmin = globalRoles.has('superadmin');
    const superadminAny = isSuperadmin;
    const isManager = superadminAny || Array.from(globalRoles).some((r) => MANAGER_TIER.has(r));
    const canSell = superadminAny || Array.from(globalRoles).some((r) => SELLER_ROLES.has(r));
    const isStaffOnly = !isManager && globalRoles.has('staff');
    return { roles: globalRoles, isManager, isStaffOnly, canSell };
  }

  const outletRoles = roleSetForOutlet(map, outletId);
  const isSuperadmin = outletRoles.has('superadmin');
  const superadminAny = isSuperadmin || globalRoles.has('superadmin');
  const isManager = superadminAny || Array.from(outletRoles).some((r) => MANAGER_TIER.has(r));
  const canSell = superadminAny || Array.from(outletRoles).some((r) => SELLER_ROLES.has(r));
  const isStaffOnly = !isManager && outletRoles.has('staff');
  return { roles: outletRoles, isManager, isStaffOnly, canSell };
}

export function useRoleForOutlet(session: AuthSession | null | undefined, outletId: string | null | undefined) {
  return useMemo(() => resolveRolesForOutlet(session, outletId), [session, outletId]);
}
