import { describe, expect, it } from 'vitest';
import type { AuthSession } from '@/api/fern-api';
import { COOKIE_AUTH_TOKEN_SENTINEL } from '@/auth/session';
import {
  FAMILY_TO_PATH,
  PATH_TO_FAMILY,
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

  it('collapses region-scoped sessions to their assigned root region instead of exposing child regions as peers', () => {
    const scopeTree = computeScopeTree(
      [
        { id: 'vn-root', name: 'Khu vực 1' },
        { id: 'vn', name: 'Vietnam' },
        { id: 'vn-hcm', name: 'Ho Chi Minh City' },
        { id: 'vn-dn', name: 'Da Nang' },
      ],
      [
        { id: 'o-vn-1', regionId: 'vn', code: 'VN-001', name: 'Vietnam Outlet 1' },
        { id: 'o-hcm-1', regionId: 'vn-hcm', code: 'HCM-001', name: 'HCM Outlet 1' },
        { id: 'o-dn-1', regionId: 'vn-dn', code: 'DN-001', name: 'Da Nang Outlet 1' },
      ],
      [
        {
          scopeType: 'region',
          scopeId: 'vn',
          scopeCode: 'VN',
          roles: ['region_manager'],
          outletIds: ['o-vn-1', 'o-hcm-1', 'o-dn-1'],
        },
      ],
    );

    expect(scopeTree[0].children).toHaveLength(1);
    expect(scopeTree[0].children?.[0]).toMatchObject({
      id: 'vn',
      name: 'Vietnam',
      level: 'region',
    });
    expect(scopeTree[0].children?.[0]?.children?.map((outlet) => outlet.id)).toEqual(['o-dn-1', 'o-hcm-1', 'o-vn-1']);
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

  it('maps organization family to the dedicated org route while keeping legacy settings redirects accessible', () => {
    expect(FAMILY_TO_PATH.org).toBe('/org/overview');
    expect(PATH_TO_FAMILY['/org']).toBe('org');
    expect(PATH_TO_FAMILY['/settings']).toBe('org');
  });
});
