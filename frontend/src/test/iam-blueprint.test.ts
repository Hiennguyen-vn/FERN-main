import { describe, expect, it } from 'vitest';
import type { AuthPermissionOverrideView, AuthScopeView, ScopeOutlet, ScopeRegion } from '@/api/fern-api';
import {
  buildLegacyMappingRows,
  buildOutletAccessRows,
  buildDirectoryMeta,
  buildFanOutPreview,
  buildRoleComparison,
  buildRoleReferences,
  collapseAssignments,
  computeEffectiveAccess,
} from '@/components/iam/iam-blueprint';

const regions: ScopeRegion[] = [
  { id: '1', code: 'hcm', name: 'HCM Region' },
];

const outlets: ScopeOutlet[] = [
  { id: '101', code: 'SGC', name: 'Saigon Centre', regionId: '1', status: 'active' },
  { id: '102', code: 'TD', name: 'Thao Dien', regionId: '1', status: 'active' },
];

function scopeRow(overrides: Partial<AuthScopeView>): AuthScopeView {
  return {
    userId: 'u-1',
    username: 'jane',
    fullName: 'Jane Pham',
    userStatus: 'active',
    outletId: '101',
    outletCode: 'SGC',
    outletName: 'Saigon Centre',
    roles: [],
    permissions: [],
    ...overrides,
  };
}

function overrideRow(overrides: Partial<AuthPermissionOverrideView> = {}): AuthPermissionOverrideView {
  return {
    userId: 'u-1',
    username: 'jane',
    fullName: 'Jane Pham',
    userStatus: 'active',
    outletId: '101',
    outletCode: 'SGC',
    outletName: 'Saigon Centre',
    permissionCode: 'purchase.approve',
    permissionName: 'Procurement Approve',
    assignedAt: '2026-04-01T08:00:00Z',
    ...overrides,
  };
}

describe('iam-blueprint helpers', () => {
  it('collapses region coverage and flags compatibility-only legacy roles', () => {
    const scopes: AuthScopeView[] = [
      scopeRow({ userId: 'u-region', username: 'finance-user', fullName: 'Finance User', outletId: '101', roles: ['finance'] }),
      scopeRow({ userId: 'u-region', username: 'finance-user', fullName: 'Finance User', outletId: '102', outletCode: 'TD', outletName: 'Thao Dien', roles: ['finance'] }),
      scopeRow({ userId: 'u-legacy', username: 'legacy-user', fullName: 'Legacy User', roles: ['inventory_clerk'] }),
    ];

    const assignments = collapseAssignments(scopes, regions, outlets);

    const regionAssignment = assignments.find((row) => row.userId === 'u-region');
    expect(regionAssignment?.scopeType).toBe('region');
    expect(regionAssignment?.scopeName).toBe('HCM Region');
    expect(regionAssignment?.outletCount).toBe(2);

    const compatibilityAssignment = assignments.find((row) => row.userId === 'u-legacy');
    expect(compatibilityAssignment?.sourceType).toBe('legacy');
    expect(compatibilityAssignment?.compatibilityOnly).toBe(true);

    const directoryMeta = buildDirectoryMeta(assignments);
    expect(directoryMeta.get('u-legacy')?.compatibilityOnlyLabels).toContain('inventory_clerk → Compatibility only');
  });

  it('shows new vs existing rows in region fan-out preview', () => {
    const assignments = collapseAssignments([
      scopeRow({ roles: ['finance'] }),
    ], regions, outlets);

    const preview = buildFanOutPreview('u-1', 'finance', '1', assignments, outlets);

    expect(preview).toHaveLength(2);
    expect(preview[0]).toMatchObject({ outletId: '101', status: 'existing' });
    expect(preview[1]).toMatchObject({ outletId: '102', status: 'new' });
  });

  it('computes allow rows, role-limit denies, and actionable deny fallbacks', () => {
    const scopes: AuthScopeView[] = [
      scopeRow({ roles: ['procurement'] }),
    ];
    const assignments = collapseAssignments(scopes, regions, outlets);
    const overrides: AuthPermissionOverrideView[] = [
      overrideRow(),
    ];

    const rows = computeEffectiveAccess('u-1', assignments, overrides, scopes, regions, outlets);

    expect(rows.some((row) =>
      row.capability === 'Procurement write'
      && row.effect === 'allow'
      && row.sourceType === 'canonical')).toBe(true);

    const roleLimitDeny = rows.find((row) =>
      row.capability === 'Procurement approve'
      && row.effect === 'deny');
    expect(roleLimitDeny?.explanation).toContain('approval requires outlet_manager or purchase.approve');

    const genericDeny = rows.find((row) =>
      row.capability === 'Sales write'
      && row.effect === 'deny');
    expect(genericDeny?.explanation).toContain('To enable:');

    expect(rows.some((row) =>
      row.capability === 'Procurement approve'
      && row.effect === 'allow'
      && row.sourceType === 'permission')).toBe(true);
  });

  it('builds legacy mapping and role comparison rows for phase 2 surfaces', () => {
    const assignments = collapseAssignments([
      scopeRow({ userId: 'u-legacy', username: 'legacy-user', fullName: 'Legacy User', roles: ['cashier'] }),
      scopeRow({ userId: 'u-compat', username: 'compat-user', fullName: 'Compat User', roles: ['inventory_clerk'] }),
    ], regions, outlets);

    const legacyRows = buildLegacyMappingRows(assignments);
    expect(legacyRows.find((row) => row.legacyCode === 'cashier')).toMatchObject({
      canonicalRole: 'staff',
      status: 'mapped',
      affectedUserCount: 1,
    });
    expect(legacyRows.find((row) => row.legacyCode === 'inventory_clerk')).toMatchObject({
      canonicalRole: undefined,
      status: 'compatibility_only',
      affectedUserCount: 1,
    });

    const roleReferences = buildRoleReferences([], []);
    const comparison = buildRoleComparison(['outlet_manager', 'procurement'], roleReferences);
    const procurementApproveRow = comparison.rows.find((row) => row.id === 'procurement.approve');
    expect(procurementApproveRow?.differs).toBe(true);
    expect(procurementApproveRow?.cells.map((cell) => cell.marker)).toEqual(['A', '—']);
    expect(comparison.summary.length).toBeGreaterThan(0);
  });

  it('summarizes outlet access by user with source separation', () => {
    const scopes: AuthScopeView[] = [
      scopeRow({ userId: 'u-manager', username: 'manager', fullName: 'Outlet Manager', roles: ['outlet_manager'] }),
      scopeRow({ userId: 'u-floor', username: 'floor', fullName: 'Floor Reader', roles: [] }),
    ];
    const assignments = collapseAssignments(scopes, regions, outlets);
    const roleReferences = buildRoleReferences([], []);

    const outletRows = buildOutletAccessRows('101', assignments, [], scopes, regions, outlets, roleReferences);

    expect(outletRows.find((row) => row.userId === 'u-manager')).toMatchObject({
      roleLabels: ['Outlet Manager'],
      sourceTypes: ['canonical', 'read_floor'],
    });
    expect(outletRows.find((row) => row.userId === 'u-floor')).toMatchObject({
      roleLabels: ['(no role)'],
      sourceTypes: ['read_floor'],
    });
  });
});
