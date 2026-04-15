import { describe, expect, it } from 'vitest';
import type { AuthSession } from '@/api/fern-api';
import { COOKIE_AUTH_TOKEN_SENTINEL } from '@/auth/session';
import {
  buildShellUser,
  collectAccessibleFamilies,
  computeScopeTree,
  defaultScope,
  filterActionHub,
  filterAccessibleModules,
} from '@/layouts/shell-layout-helpers';

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

describe('shell layout helpers', () => {
  it('builds a rooted scope tree and default outlet scope', () => {
    const scopeTree = computeScopeTree(
      [{ id: 'r1', name: 'North' }],
      [{ id: 'o1', regionId: 'r1', code: 'HN01', name: 'Hanoi 1' }],
    );

    expect(scopeTree[0].id).toBe('system');
    expect(scopeTree[0].children?.[0]?.children?.[0]?.name).toBe('HN01 · Hanoi 1');
    expect(defaultScope('outlet', scopeTree)).toEqual({
      level: 'outlet',
      regionId: 'r1',
      regionName: 'North',
      outletId: 'o1',
      outletName: 'HN01 · Hanoi 1',
    });
  });

  it('builds shell user fallbacks when profile fields are missing', () => {
    const shellUser = buildShellUser(buildSession({
      user: { id: '5', username: 'ops', fullName: '', email: null, status: 'suspended' },
    }));

    expect(shellUser.displayName).toBe('ops');
    expect(shellUser.email).toBe('unknown@fern.local');
    expect(shellUser.persona).toBe('suspended');
    expect(shellUser.avatarInitials).toBe('O');
  });

  it('filters modules and actions to the session permission surface', () => {
    const cashierSession = buildSession({
      permissionsByOutlet: { '101': ['sales.order.write'] },
    });
    const financeSession = buildSession({
      rolesByOutlet: { '101': ['finance'] },
    });

    const cashierFamilies = collectAccessibleFamilies(cashierSession);
    const cashierModules = filterAccessibleModules(cashierSession);
    const cashierActions = filterActionHub(cashierSession);
    const financeActions = filterActionHub(financeSession);

    expect(cashierFamilies.has('pos')).toBe(true);
    expect(cashierFamilies.has('finance')).toBe(false);
    expect(cashierModules.some((module) => module.family === 'pos')).toBe(true);
    expect(cashierModules.some((module) => module.family === 'finance')).toBe(false);
    expect(cashierActions.quickActions.some((action) => action.module === 'finance')).toBe(false);
    expect(financeActions.quickActions.some((action) => action.module === 'finance')).toBe(true);
  });
});
