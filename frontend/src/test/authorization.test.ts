import { describe, expect, it } from 'vitest';
import {
  hasCrmReadAccess,
  hasHrCompensationAccess,
  hasIamRoleManagementAccess,
  hasIamUserManagementAccess,
  hasModuleAccess,
  hasPosOrderingTableAccess,
  hasSalesOrderQueueAccess,
} from '@/auth/authorization';
import { COOKIE_AUTH_TOKEN_SENTINEL } from '@/auth/session';
import type { AuthSession } from '@/api/fern-api';

function buildSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: COOKIE_AUTH_TOKEN_SENTINEL,
    sessionId: 'sess-1',
    user: {
      id: '1',
      username: 'tester',
      fullName: 'Test User',
      status: 'active',
    },
    rolesByOutlet: {},
    permissionsByOutlet: {},
    ...overrides,
  };
}

describe('hasModuleAccess', () => {
  it('shows finance to finance/outlet_manager/region_manager roles per business rules §5.6', () => {
    const cashierSession = buildSession({
      rolesByOutlet: { '101': ['cashier'] },
      permissionsByOutlet: { '101': ['sales.order.write'] },
    });
    const adminSession = buildSession({
      rolesByOutlet: { '101': ['admin'] },
    });
    const accountantSession = buildSession({
      rolesByOutlet: { '101': ['accountant'] }, // legacy → finance
    });
    const outletManagerSession = buildSession({
      rolesByOutlet: { '101': ['outlet_manager'] },
    });
    const regionManagerSession = buildSession({
      rolesByOutlet: { '101': ['region_manager'] },
    });

    expect(hasModuleAccess(cashierSession, 'finance')).toBe(false);
    // admin is governance-only — no business operations (§8.1)
    expect(hasModuleAccess(adminSession, 'finance')).toBe(false);
    // accountant → finance (legacy alias), finance role has finance access
    expect(hasModuleAccess(accountantSession, 'finance')).toBe(true);
    expect(hasModuleAccess(outletManagerSession, 'finance')).toBe(true);
    expect(hasModuleAccess(regionManagerSession, 'finance')).toBe(true);
  });

  it('keeps HR attendance visible while compensation tabs stay admin-only', () => {
    const outletManager = buildSession({
      rolesByOutlet: { '101': ['outlet_manager'] },
    });
    const admin = buildSession({
      rolesByOutlet: { '101': ['admin'] },
    });

    expect(hasModuleAccess(outletManager, 'hr')).toBe(true);
    expect(hasHrCompensationAccess(outletManager)).toBe(false);
    // admin is governance-only — no payroll/compensation access (§8.1)
    expect(hasHrCompensationAccess(admin)).toBe(false);
  });

  it('keeps POS visible for outlet-scoped sales users', () => {
    const salesSession = buildSession({
      permissionsByOutlet: { '101': ['sales.order.write'] },
    });

    expect(hasModuleAccess(salesSession, 'pos')).toBe(true);
    expect(hasModuleAccess(salesSession, 'crm')).toBe(true);
    expect(hasCrmReadAccess(salesSession)).toBe(true);
    expect(hasPosOrderingTableAccess(salesSession)).toBe(true);
    expect(hasSalesOrderQueueAccess(salesSession)).toBe(true);
  });

  it('grants sales order queue to staff (incl. legacy cashier) per §5.3', () => {
    const cashier = buildSession({
      rolesByOutlet: { '101': ['cashier'] }, // legacy → staff
      permissionsByOutlet: { '101': ['inventory.read'] },
    });
    const admin = buildSession({
      rolesByOutlet: { '101': ['admin'] },
    });
    const financeOnly = buildSession({
      rolesByOutlet: { '101': ['finance'] },
    });

    // cashier → staff, staff has POS/sales access
    expect(hasSalesOrderQueueAccess(cashier)).toBe(true);
    // admin is governance-only, no sales access
    expect(hasSalesOrderQueueAccess(admin)).toBe(false);
    // finance has no sales access
    expect(hasSalesOrderQueueAccess(financeOnly)).toBe(false);
  });

  it('requires IAM permissions or admin role for IAM surfaces', () => {
    const viewer = buildSession({
      rolesByOutlet: { '101': ['cashier'] },
    });
    const userManager = buildSession({
      permissionsByOutlet: { '101': ['auth.user.write'] },
    });
    const roleManager = buildSession({
      permissionsByOutlet: { '101': ['auth.role.write'] },
    });
    const admin = buildSession({
      rolesByOutlet: { '101': ['admin'] },
    });

    expect(hasModuleAccess(viewer, 'iam')).toBe(false);
    expect(hasModuleAccess(userManager, 'iam')).toBe(true);
    expect(hasModuleAccess(roleManager, 'iam')).toBe(true);
    expect(hasIamUserManagementAccess(viewer)).toBe(false);
    expect(hasIamRoleManagementAccess(viewer)).toBe(false);
    expect(hasIamUserManagementAccess(userManager)).toBe(true);
    expect(hasIamRoleManagementAccess(userManager)).toBe(false);
    expect(hasIamUserManagementAccess(roleManager)).toBe(false);
    expect(hasIamRoleManagementAccess(roleManager)).toBe(true);
    expect(hasIamUserManagementAccess(admin)).toBe(true);
    expect(hasIamRoleManagementAccess(admin)).toBe(true);
  });
});
