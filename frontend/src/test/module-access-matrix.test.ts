/**
 * Comprehensive test suite for the config-driven module access matrix.
 *
 * Aligned with docs/authorization-business-rules.md:
 *   §2 Canonical Roles (9 roles)
 *   §3 Legacy Role Mapping
 *   §4 Domain Access Matrix
 *   §5 Domain Rules in Detail
 *   §6 Internal Service Bypass (N/A frontend)
 *   §7 Permission Matrix Fallback
 *   §8 Key Design Decisions
 */

import { describe, expect, it } from 'vitest';
import {
  hasCatalogMutationAccess,
  hasModuleAccess,
  hasFinanceWorkspaceAccess,
  hasHrOperationsAccess,
  hasHrCompensationAccess,
  hasSalesOrderQueueAccess,
  isAdminSession,
  isSuperadminSession,
} from '@/auth/authorization';
import { MODULE_ACCESS_MATRIX, LEGACY_ROLE_ALIASES } from '@/auth/module-access-matrix';
import { COOKIE_AUTH_TOKEN_SENTINEL } from '@/auth/session';
import type { AuthSession } from '@/api/fern-api';
import type { ModuleFamily } from '@/types/shell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function session(
  roles: Record<string, string[]>,
  permissions: Record<string, string[]> = {},
): AuthSession {
  return {
    accessToken: COOKIE_AUTH_TOKEN_SENTINEL,
    sessionId: 'sess-test',
    user: { id: '1', username: 'tester', fullName: 'Test User', status: 'active' },
    rolesByOutlet: roles,
    permissionsByOutlet: permissions,
  };
}

function roleSession(role: string, outletId = '101') {
  return session({ [outletId]: [role] });
}

function permSession(perm: string, outletId = '101') {
  return session({}, { [outletId]: [perm] });
}

const ALL_FAMILIES = Object.keys(MODULE_ACCESS_MATRIX) as ModuleFamily[];

function accessibleFamilies(s: AuthSession): ModuleFamily[] {
  return ALL_FAMILIES.filter((f) => hasModuleAccess(s, f));
}

// ---------------------------------------------------------------------------
// §2 — Superadmin Global Bypass
// ---------------------------------------------------------------------------

describe('Superadmin global bypass (§2, §8)', () => {
  const superadmin = roleSession('superadmin');

  it('has access to every module family', () => {
    for (const family of ALL_FAMILIES) {
      expect(hasModuleAccess(superadmin, family)).toBe(true);
    }
  });

  it('is recognized as admin and superadmin', () => {
    expect(isAdminSession(superadmin)).toBe(true);
    expect(isSuperadminSession(superadmin)).toBe(true);
  });

  it('has all convenience access checks', () => {
    expect(hasFinanceWorkspaceAccess(superadmin)).toBe(true);
    expect(hasHrOperationsAccess(superadmin)).toBe(true);
    expect(hasHrCompensationAccess(superadmin)).toBe(true);
    expect(hasSalesOrderQueueAccess(superadmin)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2, §8.1 — Admin: Governance-Only
// ---------------------------------------------------------------------------

describe('Admin scoped governance (§2, §8.1)', () => {
  const admin = roleSession('admin');

  it('is recognized as admin but not superadmin', () => {
    expect(isAdminSession(admin)).toBe(true);
    expect(isSuperadminSession(admin)).toBe(false);
  });

  // Admin at outlet 101 → has outlet membership → read-floor modules visible
  const ADMIN_ALLOWED: ModuleFamily[] = [
    'home', 'org', 'regional-ops', 'settings', 'audit', 'iam',
    // read-floor via outlet membership (§8.6)
    'catalog', 'inventory', 'reports',
  ];

  const ADMIN_DENIED: ModuleFamily[] = ALL_FAMILIES.filter(
    (f) => !ADMIN_ALLOWED.includes(f),
  );

  it('can access governance modules + read-floor via outlet membership', () => {
    for (const family of ADMIN_ALLOWED) {
      expect(hasModuleAccess(admin, family)).toBe(true);
    }
  });

  it('is denied business-specific write modules (POS, procurement, finance, HR)', () => {
    for (const family of ADMIN_DENIED) {
      expect(hasModuleAccess(admin, family)).toBe(false);
    }
  });

  it('has no finance or HR compensation access', () => {
    expect(hasFinanceWorkspaceAccess(admin)).toBe(false);
    expect(hasHrCompensationAccess(admin)).toBe(false);
    expect(hasSalesOrderQueueAccess(admin)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — Region Manager: Read Across Region
// ---------------------------------------------------------------------------

describe('Region Manager scoped read (§2, §5)', () => {
  const rm = roleSession('region_manager');

  const RM_ALLOWED: ModuleFamily[] = [
    'home', 'catalog', 'inventory', 'reports', 'finance',
    'org', 'regional-ops', 'audit',
  ];

  it('can access region-scoped read modules', () => {
    for (const family of RM_ALLOWED) {
      expect(hasModuleAccess(rm, family)).toBe(true);
    }
  });

  it('can mutate catalog for the assigned region', () => {
    expect(hasCatalogMutationAccess(rm)).toBe(true);
  });

  it('is denied POS, procurement write, IAM, HR, workforce, scheduling', () => {
    expect(hasModuleAccess(rm, 'pos')).toBe(false);
    expect(hasModuleAccess(rm, 'procurement')).toBe(false);
    expect(hasModuleAccess(rm, 'iam')).toBe(false);
    expect(hasModuleAccess(rm, 'hr')).toBe(false);
    expect(hasModuleAccess(rm, 'workforce')).toBe(false);
    expect(hasModuleAccess(rm, 'scheduling')).toBe(false);
    expect(hasModuleAccess(rm, 'crm')).toBe(false);
    expect(hasModuleAccess(rm, 'promotions')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — Outlet Manager: Store-Level Business Owner
// ---------------------------------------------------------------------------

describe('Outlet Manager scoped ops (§2, §5)', () => {
  const om = roleSession('outlet_manager');

  const OM_ALLOWED: ModuleFamily[] = [
    'home', 'pos', 'catalog', 'inventory', 'procurement',
    'finance', 'hr', 'workforce', 'scheduling', 'reports',
    'crm', 'promotions',
  ];

  it('can access all outlet business modules', () => {
    for (const family of OM_ALLOWED) {
      expect(hasModuleAccess(om, family)).toBe(true);
    }
  });

  it('is denied admin-only governance surfaces', () => {
    expect(hasModuleAccess(om, 'iam')).toBe(false);
    expect(hasModuleAccess(om, 'audit')).toBe(false);
    expect(hasModuleAccess(om, 'org')).toBe(false);
    expect(hasModuleAccess(om, 'settings')).toBe(false);
    expect(hasModuleAccess(om, 'regional-ops')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — Staff: POS/Cashier Only
// ---------------------------------------------------------------------------

describe('Staff POS-only (§2, §5.3)', () => {
  const staff = roleSession('staff');

  it('can access POS, CRM, promotions, and read-floor modules', () => {
    expect(hasModuleAccess(staff, 'home')).toBe(false);
    expect(hasModuleAccess(staff, 'pos')).toBe(true);
    expect(hasModuleAccess(staff, 'crm')).toBe(true);
    expect(hasModuleAccess(staff, 'promotions')).toBe(true);
    // read-floor via outlet membership
    expect(hasModuleAccess(staff, 'catalog')).toBe(true);
    expect(hasModuleAccess(staff, 'inventory')).toBe(true);
    expect(hasModuleAccess(staff, 'reports')).toBe(true);
  });

  it('is denied non-sales business modules', () => {
    expect(hasModuleAccess(staff, 'procurement')).toBe(false);
    expect(hasModuleAccess(staff, 'finance')).toBe(false);
    expect(hasModuleAccess(staff, 'hr')).toBe(false);
    expect(hasModuleAccess(staff, 'workforce')).toBe(false);
    expect(hasModuleAccess(staff, 'scheduling')).toBe(false);
    expect(hasModuleAccess(staff, 'iam')).toBe(false);
    expect(hasModuleAccess(staff, 'audit')).toBe(false);
    expect(hasModuleAccess(staff, 'org')).toBe(false);
    expect(hasModuleAccess(staff, 'settings')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 — Legacy product_manager alias resolves to region_manager
// ---------------------------------------------------------------------------

describe('Legacy product_manager alias (§3)', () => {
  const legacyPm = roleSession('product_manager');
  const rm = roleSession('region_manager');

  it('matches region_manager module access', () => {
    expect(accessibleFamilies(legacyPm)).toEqual(accessibleFamilies(rm));
  });

  it('inherits region_manager catalog mutation access', () => {
    expect(hasCatalogMutationAccess(legacyPm)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — Procurement: Outlet Write, No Approve
// ---------------------------------------------------------------------------

describe('Procurement outlet write (§2, §5.4, §8.4)', () => {
  const proc = roleSession('procurement');

  it('can access procurement and read-floor modules', () => {
    expect(hasModuleAccess(proc, 'home')).toBe(false);
    expect(hasModuleAccess(proc, 'procurement')).toBe(true);
    expect(hasModuleAccess(proc, 'catalog')).toBe(true); // read-floor
    expect(hasModuleAccess(proc, 'inventory')).toBe(true); // read-floor
    expect(hasModuleAccess(proc, 'reports')).toBe(true); // read-floor
  });

  it('is denied POS, finance, HR, admin surfaces', () => {
    expect(hasModuleAccess(proc, 'pos')).toBe(false);
    expect(hasModuleAccess(proc, 'finance')).toBe(false);
    expect(hasModuleAccess(proc, 'hr')).toBe(false);
    expect(hasModuleAccess(proc, 'iam')).toBe(false);
    expect(hasModuleAccess(proc, 'audit')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — Finance: Region-Scoped Finance + Payroll Approve
// ---------------------------------------------------------------------------

describe('Finance region-scoped (§2, §5.6, §5.7, §8.3)', () => {
  const fin = roleSession('finance');

  it('can access finance, reports, and read-floor modules', () => {
    expect(hasModuleAccess(fin, 'home')).toBe(false);
    expect(hasModuleAccess(fin, 'finance')).toBe(true);
    expect(hasModuleAccess(fin, 'reports')).toBe(true);
    expect(hasModuleAccess(fin, 'catalog')).toBe(true); // read-floor
    expect(hasModuleAccess(fin, 'inventory')).toBe(true); // read-floor
  });

  it('has HR compensation access (payroll approve) but not HR operations', () => {
    expect(hasHrCompensationAccess(fin)).toBe(true);
    expect(hasHrOperationsAccess(fin)).toBe(false);
  });

  it('is denied POS, procurement, admin, audit', () => {
    expect(hasModuleAccess(fin, 'pos')).toBe(false);
    expect(hasModuleAccess(fin, 'procurement')).toBe(false);
    expect(hasModuleAccess(fin, 'iam')).toBe(false);
    expect(hasModuleAccess(fin, 'audit')).toBe(false);
    expect(hasModuleAccess(fin, 'org')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — HR: Region-Scoped Scheduling + Payroll Prepare
// ---------------------------------------------------------------------------

describe('HR region-scoped (§2, §5.7, §5.8, §8.3)', () => {
  const hr = roleSession('hr');

  it('can access HR, workforce, scheduling, and read-floor modules', () => {
    expect(hasModuleAccess(hr, 'home')).toBe(false);
    expect(hasModuleAccess(hr, 'hr')).toBe(true);
    expect(hasModuleAccess(hr, 'workforce')).toBe(true);
    expect(hasModuleAccess(hr, 'scheduling')).toBe(true);
    expect(hasModuleAccess(hr, 'catalog')).toBe(true); // read-floor
    expect(hasModuleAccess(hr, 'inventory')).toBe(true); // read-floor
    expect(hasModuleAccess(hr, 'reports')).toBe(true); // read-floor
  });

  it('has HR compensation access (payroll prepare) but not finance workspace', () => {
    expect(hasHrCompensationAccess(hr)).toBe(true);
    expect(hasFinanceWorkspaceAccess(hr)).toBe(false);
  });

  it('is denied POS, procurement, finance, admin surfaces', () => {
    expect(hasModuleAccess(hr, 'pos')).toBe(false);
    expect(hasModuleAccess(hr, 'procurement')).toBe(false);
    expect(hasModuleAccess(hr, 'finance')).toBe(false);
    expect(hasModuleAccess(hr, 'iam')).toBe(false);
    expect(hasModuleAccess(hr, 'audit')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — Kitchen Staff: Minimal (Outlet Membership Read Only)
// ---------------------------------------------------------------------------

describe('Kitchen Staff minimal (§2)', () => {
  const ks = roleSession('kitchen_staff');

  it('can only access read-floor modules via outlet membership', () => {
    expect(hasModuleAccess(ks, 'home')).toBe(false);
    expect(hasModuleAccess(ks, 'catalog')).toBe(true);
    expect(hasModuleAccess(ks, 'inventory')).toBe(true);
    expect(hasModuleAccess(ks, 'reports')).toBe(true);
  });

  it('is denied all business-specific modules', () => {
    expect(hasModuleAccess(ks, 'pos')).toBe(false);
    expect(hasModuleAccess(ks, 'procurement')).toBe(false);
    expect(hasModuleAccess(ks, 'finance')).toBe(false);
    expect(hasModuleAccess(ks, 'hr')).toBe(false);
    expect(hasModuleAccess(ks, 'workforce')).toBe(false);
    expect(hasModuleAccess(ks, 'scheduling')).toBe(false);
    expect(hasModuleAccess(ks, 'iam')).toBe(false);
    expect(hasModuleAccess(ks, 'audit')).toBe(false);
    expect(hasModuleAccess(ks, 'org')).toBe(false);
    expect(hasModuleAccess(ks, 'settings')).toBe(false);
    expect(hasModuleAccess(ks, 'crm')).toBe(false);
    expect(hasModuleAccess(ks, 'promotions')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 — Legacy Role Alias Mapping
// ---------------------------------------------------------------------------

describe('Legacy role alias mapping (§3)', () => {
  it.each([
    ['cashier', 'staff'],
    ['staff_pos', 'staff'],
    ['procurement_officer', 'procurement'],
    ['hr_manager', 'hr'],
    ['finance_manager', 'finance'],
    ['finance_approver', 'finance'],
    ['regional_finance', 'finance'],
    ['accountant', 'finance'],
    ['regional_manager', 'region_manager'],
    ['product_manager', 'region_manager'],
    ['system_admin', 'admin'],
    ['technical_admin', 'admin'],
  ])('%s → %s', (legacyCode, canonicalRole) => {
    expect(LEGACY_ROLE_ALIASES[legacyCode]).toBe(canonicalRole);
  });

  it('cashier sees same modules as staff', () => {
    const cashier = roleSession('cashier');
    const staff = roleSession('staff');
    expect(accessibleFamilies(cashier)).toEqual(accessibleFamilies(staff));
  });

  it('finance_manager sees same modules as finance', () => {
    const legacy = roleSession('finance_manager');
    const canonical = roleSession('finance');
    expect(accessibleFamilies(legacy)).toEqual(accessibleFamilies(canonical));
  });

  it('system_admin sees same modules as admin', () => {
    const legacy = roleSession('system_admin');
    const canonical = roleSession('admin');
    expect(accessibleFamilies(legacy)).toEqual(accessibleFamilies(canonical));
  });

  it('regional_manager sees same modules as region_manager', () => {
    const legacy = roleSession('regional_manager');
    const canonical = roleSession('region_manager');
    expect(accessibleFamilies(legacy)).toEqual(accessibleFamilies(canonical));
  });
});

// ---------------------------------------------------------------------------
// §7 — Permission Fallback
// ---------------------------------------------------------------------------

describe('Permission fallback (§7)', () => {
  it('product.catalog.write grants catalog access', () => {
    const s = permSession('product.catalog.write');
    expect(hasModuleAccess(s, 'catalog')).toBe(true);
  });

  it('sales.order.write grants POS, CRM, promotions', () => {
    const s = permSession('sales.order.write');
    expect(hasModuleAccess(s, 'pos')).toBe(true);
    expect(hasModuleAccess(s, 'crm')).toBe(true);
    expect(hasModuleAccess(s, 'promotions')).toBe(true);
  });

  it('purchase.write grants procurement', () => {
    const s = permSession('purchase.write');
    expect(hasModuleAccess(s, 'procurement')).toBe(true);
  });

  it('purchase.approve grants procurement', () => {
    const s = permSession('purchase.approve');
    expect(hasModuleAccess(s, 'procurement')).toBe(true);
  });

  it('inventory.write grants inventory', () => {
    const s = permSession('inventory.write');
    expect(hasModuleAccess(s, 'inventory')).toBe(true);
  });

  it('hr.schedule grants HR, workforce, scheduling', () => {
    const s = permSession('hr.schedule');
    expect(hasModuleAccess(s, 'hr')).toBe(true);
    expect(hasModuleAccess(s, 'workforce')).toBe(true);
    expect(hasModuleAccess(s, 'scheduling')).toBe(true);
  });

  it('auth.user.write grants IAM', () => {
    const s = permSession('auth.user.write');
    expect(hasModuleAccess(s, 'iam')).toBe(true);
  });

  it('auth.role.write grants IAM', () => {
    const s = permSession('auth.role.write');
    expect(hasModuleAccess(s, 'iam')).toBe(true);
  });

  it('unrelated permission still grants read-floor via outlet membership (§8.6)', () => {
    const s = permSession('some.random.perm');
    const families = accessibleFamilies(s);
    // Permission entry creates outlet scope → read-floor modules visible
    expect(families).toEqual(['catalog', 'inventory', 'reports']);
  });

  it('truly empty session (no outlet scope) sees nothing', () => {
    const s = session({}, {});
    expect(accessibleFamilies(s)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §8.6 — Outlet Membership Read Floor
// ---------------------------------------------------------------------------

describe('Outlet membership read floor (§8.6)', () => {
  const READ_FLOOR_FAMILIES: ModuleFamily[] = [
    'catalog', 'inventory', 'reports',
  ];

  it('any user with an outlet sees read-floor modules', () => {
    // kitchen_staff has no explicit module access, but has outlet membership
    const ks = roleSession('kitchen_staff');
    for (const family of READ_FLOOR_FAMILIES) {
      expect(hasModuleAccess(ks, family)).toBe(true);
    }
  });

  it('user with permission-only outlet scope sees read-floor modules', () => {
    const s = permSession('inventory.write');
    for (const family of READ_FLOOR_FAMILIES) {
      expect(hasModuleAccess(s, family)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §8.3 — Separation of Duties: HR Prepares, Finance Approves
// ---------------------------------------------------------------------------

describe('Separation of duties — payroll (§5.7, §8.3)', () => {
  const hr = roleSession('hr');
  const fin = roleSession('finance');

  it('HR has compensation access (prepare) but not finance workspace', () => {
    expect(hasHrCompensationAccess(hr)).toBe(true);
    expect(hasFinanceWorkspaceAccess(hr)).toBe(false);
  });

  it('Finance has compensation access (approve) but not HR operations', () => {
    expect(hasHrCompensationAccess(fin)).toBe(true);
    expect(hasHrOperationsAccess(fin)).toBe(false);
  });

  it('neither HR nor Finance alone can do both prepare and approve', () => {
    // HR cannot access finance module (where approval lives)
    expect(hasModuleAccess(hr, 'finance')).toBe(false);
    // Finance cannot access HR module (where preparation lives)
    expect(hasModuleAccess(fin, 'hr')).toBe(false);
  });

  it('user with both roles can access both', () => {
    const dual = session({ '101': ['hr', 'finance'] });
    expect(hasModuleAccess(dual, 'hr')).toBe(true);
    expect(hasModuleAccess(dual, 'finance')).toBe(true);
    expect(hasHrCompensationAccess(dual)).toBe(true);
    expect(hasHrOperationsAccess(dual)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Null / empty session edge cases
// ---------------------------------------------------------------------------

describe('Null and empty session edge cases', () => {
  it('null session denies everything', () => {
    for (const family of ALL_FAMILIES) {
      expect(hasModuleAccess(null, family)).toBe(false);
    }
    expect(isAdminSession(null)).toBe(false);
    expect(isSuperadminSession(null)).toBe(false);
    expect(hasFinanceWorkspaceAccess(null)).toBe(false);
    expect(hasHrOperationsAccess(null)).toBe(false);
    expect(hasHrCompensationAccess(null)).toBe(false);
    expect(hasSalesOrderQueueAccess(null)).toBe(false);
  });

  it('session with empty roles/permissions sees nothing', () => {
    const empty = session({}, {});
    const families = accessibleFamilies(empty);
    expect(families).toEqual([]);
  });

  it('session with roles at outlet gives outlet membership', () => {
    const s = session({ '101': ['kitchen_staff'] });
    // kitchen_staff has no explicit access, but outlet membership enables read-floor
    expect(hasModuleAccess(s, 'home')).toBe(false);
    expect(hasModuleAccess(s, 'catalog')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Golden E2E test — exact expected modules per role (§4 Domain Access Matrix)
// This is the authoritative cross-check: if this fails, either the matrix
// config or the business rules doc is wrong.
// ---------------------------------------------------------------------------

describe('Golden module visibility per role (§4)', () => {
  /**
   * Expected visible modules per canonical role.
   * Read-floor modules (home, catalog, inventory, reports) are visible
   * to any role with outlet membership (§8.6).
   */
  const GOLDEN: Record<string, string[]> = {
    superadmin:      'home pos catalog inventory procurement finance hr workforce scheduling org regional-ops settings reports audit iam crm promotions'.split(' '),
    admin:           'home catalog inventory org regional-ops settings reports audit iam'.split(' '),
    region_manager:  'home catalog inventory finance org regional-ops reports audit'.split(' '),
    outlet_manager:  'home pos catalog inventory procurement finance hr workforce scheduling reports crm promotions'.split(' '),
    staff:           'pos catalog inventory reports crm promotions'.split(' '),
    procurement:     'catalog inventory procurement reports'.split(' '),
    finance:         'catalog inventory finance reports'.split(' '),
    hr:              'catalog inventory hr workforce scheduling reports'.split(' '),
    kitchen_staff:   'catalog inventory reports'.split(' '),
  };

  it.each(Object.entries(GOLDEN))('%s sees exactly the expected modules', (role, expected) => {
    const s = roleSession(role);
    const actual = accessibleFamilies(s).sort();
    const exp = [...expected].sort();
    expect(actual).toEqual(exp);
  });

  it('admin with real backend permissions (governance-only suppression)', () => {
    // Simulates actual backend response: admin gets 4 governance perms
    const s = session(
      { '2000': ['admin'], '2002': ['admin'] },
      { '2000': ['auth.user.write', 'auth.role.write', 'org.write', 'audit.read'],
        '2002': ['auth.user.write', 'auth.role.write', 'org.write', 'audit.read'] },
    );
    const actual = accessibleFamilies(s).sort();
    const expected = 'home catalog inventory org regional-ops settings reports audit iam'.split(' ').sort();
    expect(actual).toEqual(expected);
  });

  it('outlet_manager with real backend permissions', () => {
    // Simulates actual backend response
    const s = session(
      { '2000': ['outlet_manager'] },
      { '2000': ['purchase.approve', 'sales.order.write', 'inventory.write', 'inventory.read',
                  'inventory.adjust', 'sale.refund', 'procurement.write', 'procurement.read',
                  'procurement.approve', 'procurement.po.write', 'report.view',
                  'hr.schedule.manage', 'hr.attendance.approve', 'hr.payroll.view'] },
    );
    const actual = accessibleFamilies(s).sort();
    const expected = 'home pos catalog inventory procurement finance hr workforce scheduling reports crm promotions'.split(' ').sort();
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Matrix completeness
// ---------------------------------------------------------------------------

describe('Matrix completeness', () => {
  const expectedFamilies: ModuleFamily[] = [
    'home', 'pos', 'catalog', 'inventory', 'procurement',
    'finance', 'hr', 'workforce', 'scheduling',
    'org', 'regional-ops', 'settings',
    'reports', 'audit', 'iam', 'crm', 'promotions',
  ];

  it('MODULE_ACCESS_MATRIX covers all ModuleFamily values', () => {
    for (const family of expectedFamilies) {
      expect(MODULE_ACCESS_MATRIX).toHaveProperty(family);
    }
  });

  it('every matrix entry has the expected shape', () => {
    for (const [, rule] of Object.entries(MODULE_ACCESS_MATRIX)) {
      expect(Array.isArray(rule.roles)).toBe(true);
      expect(Array.isArray(rule.permissions)).toBe(true);
      expect(typeof rule.outletMembership).toBe('boolean');
    }
  });
});
