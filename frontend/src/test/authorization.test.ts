import { describe, expect, it } from 'vitest';
import { hasModuleAccess } from '@/auth/authorization';
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
  it('shows finance only to admin-grade sessions', () => {
    const scopedSession = buildSession({
      rolesByOutlet: { '101': ['cashier'] },
      permissionsByOutlet: { '101': ['sales.order.write'] },
    });
    const adminSession = buildSession({
      rolesByOutlet: { '101': ['admin'] },
    });

    expect(hasModuleAccess(scopedSession, 'finance')).toBe(false);
    expect(hasModuleAccess(adminSession, 'finance')).toBe(true);
  });

  it('keeps POS visible for outlet-scoped sales users', () => {
    const salesSession = buildSession({
      permissionsByOutlet: { '101': ['sales.order.write'] },
    });

    expect(hasModuleAccess(salesSession, 'pos')).toBe(true);
    expect(hasModuleAccess(salesSession, 'crm')).toBe(true);
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
