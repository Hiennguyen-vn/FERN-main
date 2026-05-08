import { describe, expect, it } from 'vitest';
import type { AuthSession } from '@/api/auth-api';
import { resolveRolesForOutlet } from '@/routes/pos-order/hooks/use-role-for-outlet';

function session(
  rolesByOutlet: Record<string, string[]>,
  canonicalRolesByOutlet: Record<string, string[]> = {},
): AuthSession {
  return {
    accessToken: 'token',
    sessionId: 'sess-1',
    user: {
      id: '1',
      username: 'tester',
      fullName: 'Test User',
      status: 'active',
    },
    rolesByOutlet,
    permissionsByOutlet: {},
    canonicalRolesByOutlet,
  };
}

describe('resolveRolesForOutlet', () => {
  it('allows superadmin to open the POS session monitor when scope is All', () => {
    const result = resolveRolesForOutlet(session({ '101': ['superadmin'], '102': ['superadmin'] }), null);

    expect(result.isManager).toBe(true);
    expect(result.isStaffOnly).toBe(false);
    expect(result.canSell).toBe(true);
  });

  it('falls back to rolesByOutlet when canonicalRolesByOutlet is empty (backend omits or {})', () => {
    const result = resolveRolesForOutlet(
      session({ '101': ['superadmin'] }, {}),
      null,
    );

    expect(result.isManager).toBe(true);
    expect(result.canSell).toBe(true);
  });

  it('allows outlet_manager at region scope (no outlet selected)', () => {
    const result = resolveRolesForOutlet(session({ '101': ['outlet_manager'], '102': ['outlet_manager'] }), null);

    expect(result.isManager).toBe(true);
    expect(result.canSell).toBe(true);
  });

  it('does not treat outlet staff as global monitor users when scope is All', () => {
    const result = resolveRolesForOutlet(session({ '101': ['cashier'] }), null);

    expect(result.isManager).toBe(false);
    expect(result.canSell).toBe(true);
    expect(result.isStaffOnly).toBe(true);
  });
});
