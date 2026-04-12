import { describe, expect, it } from 'vitest';
import {
  hasHrCompensationAccess,
  hasModuleAccess,
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
  it('shows finance only to admin users while backend keeps finance admin-only', () => {
    const cashierSession = buildSession({
      rolesByOutlet: { '101': ['cashier'] },
      permissionsByOutlet: { '101': ['sales.order.write'] },
    });
    const adminSession = buildSession({
      rolesByOutlet: { '101': ['admin'] },
    });
    const accountantSession = buildSession({
      rolesByOutlet: { '101': ['accountant'] },
    });
    const payrollSession = buildSession({
      permissionsByOutlet: { '101': ['payroll.approve'] },
    });

    expect(hasModuleAccess(cashierSession, 'finance')).toBe(false);
    expect(hasModuleAccess(adminSession, 'finance')).toBe(true);
    expect(hasModuleAccess(accountantSession, 'finance')).toBe(false);
    expect(hasModuleAccess(payrollSession, 'finance')).toBe(false);
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
    expect(hasHrCompensationAccess(admin)).toBe(true);
  });

  it('keeps POS visible for outlet-scoped sales users', () => {
    const salesSession = buildSession({
      permissionsByOutlet: { '101': ['sales.order.write'] },
    });

    expect(hasModuleAccess(salesSession, 'pos')).toBe(true);
    expect(hasModuleAccess(salesSession, 'crm')).toBe(true);
    expect(hasSalesOrderQueueAccess(salesSession)).toBe(true);
  });

  it('restricts customer-order queue to staff who can actually process sales', () => {
    const viewer = buildSession({
      rolesByOutlet: { '101': ['cashier'] },
      permissionsByOutlet: { '101': ['inventory.read'] },
    });
    const admin = buildSession({
      rolesByOutlet: { '101': ['admin'] },
    });

    expect(hasSalesOrderQueueAccess(viewer)).toBe(false);
    expect(hasSalesOrderQueueAccess(admin)).toBe(true);
  });

  it('requires IAM permissions or admin role for IAM surfaces', () => {
    const viewer = buildSession({
      rolesByOutlet: { '101': ['cashier'] },
    });
    const iamManager = buildSession({
      permissionsByOutlet: { '101': ['auth.user.write'] },
    });

    expect(hasModuleAccess(viewer, 'iam')).toBe(false);
    expect(hasModuleAccess(iamManager, 'iam')).toBe(true);
  });
});
