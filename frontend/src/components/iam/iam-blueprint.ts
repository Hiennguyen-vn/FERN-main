import { LEGACY_ROLE_ALIASES } from '@/auth/module-access-matrix';
import type {
  AuthBusinessRoleCatalogItem,
  AuthPermissionCatalogItem,
  AuthPermissionOverrideView,
  AuthRoleCatalogItem,
  AuthScopeView,
} from '@/api/fern-api';
import type { ScopeOutlet, ScopeRegion } from '@/api/org-api';

export type IamScopeType = 'global' | 'region' | 'outlet';
export type IamSourceType = 'canonical' | 'legacy' | 'permission' | 'read_floor' | 'denied';
export type IamEffect = 'allow' | 'deny';
export type IamTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

export interface RoleReference {
  code: string;
  name: string;
  scopeType: IamScopeType;
  description: string;
  aliases: string[];
  badge?: string;
  tone: IamTone;
  purpose: string;
  capabilities: string[];
  limits: string[];
  assignedPermissionCount?: number;
}

export interface PermissionReference {
  code: string;
  label: string;
  businessMeaning: string;
  scope: 'Global' | 'Outlet';
  sensitive: boolean;
  description?: string | null;
  assignedRoleCount?: number;
}

export interface CollapsedAssignment {
  key: string;
  userId: string;
  username: string;
  fullName: string;
  userStatus?: string | null;
  roleCode: string;
  canonicalRole: string;
  sourceType: 'canonical' | 'legacy';
  legacyCode?: string | null;
  scopeType: IamScopeType;
  scopeId: string;
  scopeName: string;
  outletIds: string[];
  outletCount: number;
  compatibilityOnly: boolean;
}

export interface DirectoryUserMeta {
  primaryRoleCode?: string;
  primaryRoleLabel?: string;
  dominantScopeType?: IamScopeType;
  additionalRoleCount: number;
  scopeSummary: string;
  legacyLabels: string[];
  compatibilityOnlyLabels: string[];
  outletCount: number;
  hasSuperadmin: boolean;
}

export interface ScopeBucket {
  scopeType: IamScopeType;
  scopeId: string;
  scopeName: string;
  outletIds: string[];
  outletCount: number;
}

export interface FanOutPreviewRow {
  outletId: string;
  outletCode?: string | null;
  outletName: string;
  status: 'new' | 'existing';
  note: string;
}

export interface EffectiveAccessRow {
  id: string;
  domain: string;
  capability: string;
  effect: IamEffect;
  scopeType: IamScopeType;
  scopeLabel: string;
  sourceType: IamSourceType;
  sourceLabel: string;
  explanation: string;
  sensitive: boolean;
}

export interface LegacyMappingRow {
  legacyCode: string;
  canonicalRole?: string;
  canonicalLabel?: string;
  affectedUserCount: number;
  status: 'mapped' | 'compatibility_only';
}

export interface RoleComparisonCell {
  roleCode: string;
  roleName: string;
  allowed: boolean;
  marker: 'R' | 'W' | 'A' | 'FULL' | '—';
  scopeType: IamScopeType;
}

export interface RoleComparisonRow {
  id: string;
  domain: string;
  capability: string;
  cells: RoleComparisonCell[];
  differs: boolean;
}

export interface OutletAccessRow {
  userId: string;
  username: string;
  fullName: string;
  userStatus?: string | null;
  roleLabels: string[];
  scopeLabels: string[];
  domainAccessSummary: string[];
  sourceTypes: IamSourceType[];
}

interface CapabilityDescriptor {
  id: string;
  domain: string;
  capability: string;
  suggestedRole?: string;
  suggestedPermission?: string;
  sensitive?: boolean;
}

const ROLE_ORDER = [
  'superadmin',
  'admin',
  'region_manager',
  'outlet_manager',
  'finance',
  'hr',
  'product_manager',
  'procurement',
  'staff',
  'kitchen_staff',
] as const;

const ROLE_PRIORITY = new Map<string, number>(ROLE_ORDER.map((role, index) => [role, index]));

const ROLE_REFERENCE_COPY: Record<string, Omit<RoleReference, 'assignedPermissionCount'>> = {
  superadmin: {
    code: 'superadmin',
    name: 'Superadmin',
    scopeType: 'global',
    description: 'Full chain-wide authority and emergency override.',
    aliases: [],
    badge: 'FULL ACCESS',
    tone: 'danger',
    purpose: 'Full system access. Emergency override.',
    capabilities: ['All domains — read, write, approve.', 'Global scope across every outlet.'],
    limits: ['No restrictions.'],
  },
  admin: {
    code: 'admin',
    name: 'Admin',
    scopeType: 'region',
    description: 'Scoped IAM governance for region or outlet.',
    aliases: ['system_admin', 'technical_admin'],
    badge: 'GOVERNANCE ONLY',
    tone: 'warning',
    purpose: 'IAM governance within scope. No business operations.',
    capabilities: ['Org read and mutate.', 'IAM user and role management.', 'Audit read.'],
    limits: ['No sales, procurement, inventory, finance, HR, or catalog mutation.'],
  },
  region_manager: {
    code: 'region_manager',
    name: 'Region Manager',
    scopeType: 'region',
    description: 'Regional operational oversight.',
    aliases: ['regional_manager'],
    badge: 'READ OVERSIGHT',
    tone: 'info',
    purpose: 'Operational oversight and read access across a region.',
    capabilities: ['Region-scoped operational read.', 'Audit visibility for assigned region.'],
    limits: ['No business writes or approvals.'],
  },
  outlet_manager: {
    code: 'outlet_manager',
    name: 'Outlet Manager',
    scopeType: 'outlet',
    description: 'Outlet owner for store operations and approvals.',
    aliases: [],
    tone: 'neutral',
    purpose: 'Store-level business owner. Final approver.',
    capabilities: ['Sales write.', 'Procurement write and approve.', 'Inventory and finance write.'],
    limits: ['No catalog mutation.', 'No payroll prepare or approve.', 'No audit read.'],
  },
  staff: {
    code: 'staff',
    name: 'Staff',
    scopeType: 'outlet',
    description: 'Frontline cashier and POS operator.',
    aliases: ['cashier', 'staff_pos'],
    badge: 'POS ONLY',
    tone: 'info',
    purpose: 'POS/cashier operator. Sales order flow only.',
    capabilities: ['Sales write at assigned outlet.', 'Basic outlet reads via membership.'],
    limits: ['No procurement, inventory write, finance, HR, or catalog mutation.'],
  },
  product_manager: {
    code: 'product_manager',
    name: 'Product Manager',
    scopeType: 'region',
    description: 'Regional menu, catalog, and pricing owner.',
    aliases: [],
    badge: 'CATALOG ONLY',
    tone: 'success',
    purpose: 'Catalog/menu/pricing management within a region.',
    capabilities: ['Catalog read and mutate within region.'],
    limits: ['No sales, procurement, inventory write, finance, HR, or audit.'],
  },
  procurement: {
    code: 'procurement',
    name: 'Procurement',
    scopeType: 'outlet',
    description: 'Store procurement operator without final approval.',
    aliases: ['procurement_officer'],
    badge: 'REQUESTER ONLY',
    tone: 'warning',
    purpose: 'Purchase order creation and processing. No final approval.',
    capabilities: ['Procurement write at outlet.', 'Operational reads via outlet scope.'],
    limits: ['Cannot approve POs or goods receipts.', 'No catalog mutation, finance, or audit.'],
  },
  finance: {
    code: 'finance',
    name: 'Finance',
    scopeType: 'region',
    description: 'Regional finance and payroll approver.',
    aliases: ['finance_manager', 'finance_approver', 'regional_finance', 'accountant'],
    badge: 'PAYROLL APPROVER',
    tone: 'warning',
    purpose: 'Financial operations, expense management, payroll approval within a region.',
    capabilities: ['Finance read and write.', 'Payroll approval in region.', 'Report read.'],
    limits: ['Cannot prepare payroll.', 'No sales, procurement write, inventory write, or audit.'],
  },
  hr: {
    code: 'hr',
    name: 'HR',
    scopeType: 'region',
    description: 'Regional HR, scheduling, contracts, and payroll preparation.',
    aliases: ['hr_manager'],
    badge: 'PAYROLL PREPARER',
    tone: 'info',
    purpose: 'Employee contracts, scheduling, and payroll preparation within a region.',
    capabilities: ['Payroll prepare.', 'HR schedule and contracts.'],
    limits: ['Cannot approve payroll.', 'No finance write, procurement write, or audit.'],
  },
  kitchen_staff: {
    code: 'kitchen_staff',
    name: 'Kitchen Staff',
    scopeType: 'outlet',
    description: 'Outlet kitchen and fulfillment operator.',
    aliases: [],
    badge: 'MINIMAL ACCESS',
    tone: 'info',
    purpose: 'Kitchen fulfillment. No business operations beyond outlet membership.',
    capabilities: ['Basic outlet reads via membership.'],
    limits: ['No business writes or approvals in any domain.'],
  },
};

const PERMISSION_REFERENCE_COPY: Record<string, PermissionReference> = {
  'product.catalog.write': {
    code: 'product.catalog.write',
    label: 'Catalog Write',
    businessMeaning: 'Create and edit products, items, prices, and recipes.',
    scope: 'Outlet',
    sensitive: false,
  },
  'sales.order.write': {
    code: 'sales.order.write',
    label: 'Sales Write',
    businessMeaning: 'Submit, process, cancel, and pay sales orders.',
    scope: 'Outlet',
    sensitive: false,
  },
  'purchase.write': {
    code: 'purchase.write',
    label: 'Procurement Write',
    businessMeaning: 'Create purchase orders, goods receipts, invoices, and payments.',
    scope: 'Outlet',
    sensitive: false,
  },
  'purchase.approve': {
    code: 'purchase.approve',
    label: 'Procurement Approve',
    businessMeaning: 'Approve purchase orders and goods receipts.',
    scope: 'Outlet',
    sensitive: true,
  },
  'inventory.write': {
    code: 'inventory.write',
    label: 'Inventory Write',
    businessMeaning: 'Manage stock counts, waste records, and stock mutations.',
    scope: 'Outlet',
    sensitive: false,
  },
  'hr.schedule': {
    code: 'hr.schedule',
    label: 'HR Schedule',
    businessMeaning: 'Create and update shift schedules.',
    scope: 'Outlet',
    sensitive: false,
  },
  'auth.user.write': {
    code: 'auth.user.write',
    label: 'User Mgmt',
    businessMeaning: 'Create, modify, and deactivate user accounts.',
    scope: 'Global',
    sensitive: true,
  },
  'auth.role.write': {
    code: 'auth.role.write',
    label: 'Role Mgmt',
    businessMeaning: 'Assign roles and manage role permission bundles.',
    scope: 'Global',
    sensitive: true,
  },
};

const CAPABILITY_CATALOG: CapabilityDescriptor[] = [
  { id: 'org.read', domain: 'Organization', capability: 'Org read', suggestedRole: 'admin' },
  { id: 'org.mutate', domain: 'Organization', capability: 'Org mutate', suggestedRole: 'admin' },
  { id: 'catalog.read', domain: 'Catalog', capability: 'Catalog read', suggestedRole: 'product_manager' },
  { id: 'catalog.mutate', domain: 'Catalog', capability: 'Catalog mutate', suggestedRole: 'product_manager', suggestedPermission: 'product.catalog.write' },
  { id: 'sales.read', domain: 'Sales', capability: 'Sales read', suggestedRole: 'staff' },
  { id: 'sales.write', domain: 'Sales', capability: 'Sales write', suggestedRole: 'staff', suggestedPermission: 'sales.order.write' },
  { id: 'procurement.read', domain: 'Procurement', capability: 'Procurement read', suggestedRole: 'procurement' },
  { id: 'procurement.write', domain: 'Procurement', capability: 'Procurement write', suggestedRole: 'procurement', suggestedPermission: 'purchase.write' },
  { id: 'procurement.approve', domain: 'Procurement', capability: 'Procurement approve', suggestedRole: 'outlet_manager', suggestedPermission: 'purchase.approve', sensitive: true },
  { id: 'inventory.read', domain: 'Inventory', capability: 'Inventory read', suggestedRole: 'outlet_manager' },
  { id: 'inventory.write', domain: 'Inventory', capability: 'Inventory write', suggestedRole: 'outlet_manager', suggestedPermission: 'inventory.write' },
  { id: 'finance.read', domain: 'Finance', capability: 'Finance read', suggestedRole: 'finance' },
  { id: 'finance.write', domain: 'Finance', capability: 'Finance write', suggestedRole: 'finance' },
  { id: 'payroll.prepare', domain: 'Payroll', capability: 'Payroll prepare', suggestedRole: 'hr' },
  { id: 'payroll.approve', domain: 'Payroll', capability: 'Payroll approve', suggestedRole: 'finance' },
  { id: 'hr.schedule', domain: 'HR', capability: 'HR schedule', suggestedRole: 'hr', suggestedPermission: 'hr.schedule' },
  { id: 'hr.contracts', domain: 'HR', capability: 'HR contracts', suggestedRole: 'hr' },
  { id: 'audit.read', domain: 'Audit', capability: 'Audit read', suggestedRole: 'admin' },
  { id: 'report.read', domain: 'Reports', capability: 'Report read', suggestedRole: 'region_manager' },
];

const ROLE_GRANTS: Record<string, string[]> = {
  superadmin: CAPABILITY_CATALOG.map((item) => item.id),
  admin: ['org.read', 'org.mutate', 'audit.read'],
  region_manager: ['org.read', 'catalog.read', 'sales.read', 'procurement.read', 'inventory.read', 'finance.read', 'audit.read', 'report.read'],
  outlet_manager: ['org.read', 'catalog.read', 'sales.read', 'sales.write', 'procurement.read', 'procurement.write', 'procurement.approve', 'inventory.read', 'inventory.write', 'finance.read', 'finance.write', 'hr.schedule', 'hr.contracts', 'report.read'],
  staff: ['org.read', 'catalog.read', 'sales.read', 'sales.write', 'inventory.read', 'report.read'],
  product_manager: ['org.read', 'catalog.read', 'catalog.mutate', 'sales.read', 'inventory.read', 'report.read'],
  procurement: ['org.read', 'catalog.read', 'sales.read', 'procurement.read', 'procurement.write', 'inventory.read', 'report.read'],
  finance: ['org.read', 'catalog.read', 'sales.read', 'procurement.read', 'inventory.read', 'finance.read', 'finance.write', 'payroll.approve', 'report.read'],
  hr: ['org.read', 'catalog.read', 'sales.read', 'procurement.read', 'inventory.read', 'payroll.prepare', 'hr.schedule', 'hr.contracts', 'report.read'],
  kitchen_staff: ['org.read', 'catalog.read', 'inventory.read', 'report.read'],
};

const PERMISSION_GRANTS: Record<string, string[]> = {
  'product.catalog.write': ['catalog.mutate'],
  'sales.order.write': ['sales.write'],
  'purchase.write': ['procurement.write'],
  'purchase.approve': ['procurement.approve'],
  'inventory.write': ['inventory.write'],
  'hr.schedule': ['hr.schedule'],
  'auth.user.write': [],
  'auth.role.write': [],
};

const READ_FLOOR_CAPABILITY_IDS = ['catalog.read', 'sales.read', 'procurement.read', 'inventory.read', 'report.read'];

const ROLE_LIMITATIONS: Partial<Record<string, Record<string, string>>> = {
  admin: {
    'sales.write': 'Admin is governance-only. It does not grant business operations like sales, procurement, or inventory.',
    'catalog.mutate': 'Admin manages IAM and organization structure, but cannot mutate the product catalog.',
  },
  region_manager: {
    'sales.write': 'Region Manager is an oversight role. It does not grant business writes or approvals.',
    'procurement.approve': 'Region Manager can review operations but cannot approve procurement transactions.',
  },
  procurement: {
    'procurement.approve': 'Procurement role can create requests, but approval requires outlet_manager or purchase.approve.',
  },
  finance: {
    'payroll.prepare': 'Finance approves payroll, but payroll preparation is reserved for HR.',
  },
  hr: {
    'payroll.approve': 'HR prepares payroll, but approval is reserved for Finance.',
  },
  product_manager: {
    'sales.write': 'Product Manager is limited to catalog and pricing operations.',
  },
  staff: {
    'procurement.write': 'Staff is limited to sales/POS operations at the assigned outlet.',
  },
  kitchen_staff: {
    'sales.write': 'Kitchen Staff has read-only outlet membership access and no business write capability.',
  },
};

export const IAM_PERMISSION_CODES = Object.keys(PERMISSION_REFERENCE_COPY);
export const IAM_SENSITIVE_PERMISSION_CODES = new Set(
  IAM_PERMISSION_CODES.filter((code) => PERMISSION_REFERENCE_COPY[code].sensitive),
);

const CANONICAL_ROLE_CODES = new Set<string>(ROLE_ORDER);

function canonicalizeRole(roleCode: string) {
  const normalized = String(roleCode || '').trim();
  const mappedRole = LEGACY_ROLE_ALIASES[normalized];
  const compatibilityOnly = !mappedRole && normalized.length > 0 && !CANONICAL_ROLE_CODES.has(normalized);
  const canonicalRole = mappedRole ?? normalized;
  return {
    canonicalRole,
    sourceType: mappedRole || compatibilityOnly ? 'legacy' as const : 'canonical' as const,
    legacyCode: mappedRole || compatibilityOnly ? normalized : null,
    compatibilityOnly,
  };
}

function buildOutletMaps(regions: ScopeRegion[], outlets: ScopeOutlet[]) {
  const outletsById = new Map(outlets.map((outlet) => [String(outlet.id), outlet]));
  const regionsById = new Map(regions.map((region) => [String(region.id), region]));
  const regionOutletIds = new Map<string, string[]>();
  outlets.forEach((outlet) => {
    const regionId = String(outlet.regionId);
    const row = regionOutletIds.get(regionId) ?? [];
    row.push(String(outlet.id));
    regionOutletIds.set(regionId, row);
  });
  return { outletsById, regionsById, regionOutletIds };
}

function normalizeScopeType(scopeType?: string | null): IamScopeType {
  if (scopeType === 'global' || scopeType === 'region' || scopeType === 'outlet') {
    return scopeType;
  }
  return 'outlet';
}

function sortCollapsedAssignments(rows: CollapsedAssignment[]) {
  const scopePriority: Record<IamScopeType, number> = { global: 0, region: 1, outlet: 2 };
  return [...rows].sort((a, b) => {
    const roleDiff = (ROLE_PRIORITY.get(a.canonicalRole) ?? 999) - (ROLE_PRIORITY.get(b.canonicalRole) ?? 999);
    if (roleDiff !== 0) return roleDiff;
    const scopeDiff = scopePriority[a.scopeType] - scopePriority[b.scopeType];
    if (scopeDiff !== 0) return scopeDiff;
    return a.scopeName.localeCompare(b.scopeName);
  });
}

function sortRoleReferences(rows: RoleReference[]) {
  const scopePriority: Record<IamScopeType, number> = { global: 0, region: 1, outlet: 2 };
  return [...rows].sort((a, b) => {
    const roleDiff = (ROLE_PRIORITY.get(a.code) ?? 999) - (ROLE_PRIORITY.get(b.code) ?? 999);
    if (roleDiff !== 0) return roleDiff;
    const scopeDiff = scopePriority[a.scopeType] - scopePriority[b.scopeType];
    if (scopeDiff !== 0) return scopeDiff;
    return a.name.localeCompare(b.name);
  });
}

export function buildRoleReferences(
  businessRoles: AuthBusinessRoleCatalogItem[],
  roleCatalog: AuthRoleCatalogItem[],
) : RoleReference[] {
  const catalogByCode = new Map(roleCatalog.map((item) => [item.code, item]));
  const businessRolesByCode = new Map(businessRoles.map((item) => [item.code, item]));
  // Collect all legacy alias codes so we can exclude them from the role grid.
  // These are stored codes (e.g. 'cashier', 'procurement_officer') that map to
  // canonical codes (e.g. 'staff', 'procurement') which already exist in ROLE_REFERENCE_COPY.
  const allAliasStoredCodes = new Set<string>([
    ...Object.keys(LEGACY_ROLE_ALIASES),
    // Also exclude stored codes that differ from canonical code (e.g. 'cashier' is stored for 'staff')
    ...Object.values(ROLE_REFERENCE_COPY).flatMap((role) => role.aliases),
  ]);
  const knownCodes = new Set([
    ...Object.keys(ROLE_REFERENCE_COPY),
    ...businessRoles.map((item) => item.code).filter((code) => !allAliasStoredCodes.has(code)),
    ...roleCatalog.map((item) => item.code).filter((code) => !allAliasStoredCodes.has(code)),
  ]);
  const merged = [...knownCodes].map((code) => {
    const businessRole = businessRolesByCode.get(code);
    const base = ROLE_REFERENCE_COPY[code] ?? {
      code,
      name: businessRole?.name || code,
      scopeType: normalizeScopeType(businessRole?.scopeType),
      description: businessRole?.description || '',
      aliases: businessRole?.aliases || [],
      tone: 'neutral' as const,
      purpose: businessRole?.description || '',
      capabilities: [],
      limits: [],
    };
    const catalog = catalogByCode.get(code);
    return {
      ...base,
      name: businessRole?.name || base.name,
      description: businessRole?.description || catalog?.description || base.description,
      scopeType: normalizeScopeType(businessRole?.scopeType || base.scopeType),
      aliases: businessRole && businessRole.aliases.length > 0 ? businessRole.aliases : base.aliases,
      assignedPermissionCount: catalog?.assignedPermissionCount ?? 0,
    } satisfies RoleReference;
  });
  return sortRoleReferences(merged);
}

export function buildPermissionReferences(permissionCatalog: AuthPermissionCatalogItem[]) {
  const catalogByCode = new Map(permissionCatalog.map((item) => [item.code, item]));
  return IAM_PERMISSION_CODES.map((code) => {
    const catalogItem = catalogByCode.get(code);
    const base = PERMISSION_REFERENCE_COPY[code];
    return {
      ...base,
      description: catalogItem?.description ?? base.description ?? null,
      assignedRoleCount: catalogItem?.assignedRoleCount ?? 0,
    } satisfies PermissionReference;
  });
}

export function collapseAssignments(
  scopes: AuthScopeView[],
  regions: ScopeRegion[],
  outlets: ScopeOutlet[],
) {
  const { outletsById, regionsById, regionOutletIds } = buildOutletMaps(regions, outlets);
  const allOutletIds = outlets.map((outlet) => String(outlet.id));
  const grouped = new Map<string, { userId: string; username: string; fullName: string; userStatus?: string | null; roleCode: string; outletIds: Set<string> }>();

  scopes.forEach((row) => {
    row.roles.forEach((roleCode) => {
      const key = `${row.userId}:${roleCode}`;
      const current = grouped.get(key) ?? {
        userId: row.userId,
        username: row.username,
        fullName: row.fullName,
        userStatus: row.userStatus,
        roleCode,
        outletIds: new Set<string>(),
      };
      current.outletIds.add(String(row.outletId));
      grouped.set(key, current);
    });
  });

  const assignments: CollapsedAssignment[] = [];
  grouped.forEach((group) => {
    const { canonicalRole, sourceType, legacyCode, compatibilityOnly } = canonicalizeRole(group.roleCode);
    const remaining = new Set(group.outletIds);
    const outletIds = [...group.outletIds];
    const hasGlobalCoverage = canonicalRole === 'superadmin' && allOutletIds.length > 0 && allOutletIds.every((id) => remaining.has(id));
    if (hasGlobalCoverage) {
      assignments.push({
        key: `${group.userId}:${group.roleCode}:global`,
        userId: group.userId,
        username: group.username,
        fullName: group.fullName,
        userStatus: group.userStatus,
        roleCode: group.roleCode,
        canonicalRole,
        sourceType,
        legacyCode,
        scopeType: 'global',
        scopeId: 'global',
        scopeName: 'All outlets',
        outletIds,
        outletCount: outletIds.length,
        compatibilityOnly,
      });
      return;
    }

    [...regionOutletIds.entries()]
      .sort((a, b) => (regionsById.get(a[0])?.name || a[0]).localeCompare(regionsById.get(b[0])?.name || b[0]))
      .forEach(([regionId, regionOutlets]) => {
        if (regionOutlets.length === 0) return;
        if (!regionOutlets.every((outletId) => remaining.has(outletId))) return;
        regionOutlets.forEach((outletId) => remaining.delete(outletId));
        assignments.push({
          key: `${group.userId}:${group.roleCode}:region:${regionId}`,
          userId: group.userId,
          username: group.username,
          fullName: group.fullName,
          userStatus: group.userStatus,
          roleCode: group.roleCode,
          canonicalRole,
          sourceType,
          legacyCode,
          scopeType: 'region',
          scopeId: regionId,
          scopeName: regionsById.get(regionId)?.name || `Region ${regionId}`,
          outletIds: [...regionOutlets],
          outletCount: regionOutlets.length,
          compatibilityOnly,
        });
      });

    [...remaining]
      .sort((a, b) => (outletsById.get(a)?.name || a).localeCompare(outletsById.get(b)?.name || b))
      .forEach((outletId) => {
        assignments.push({
          key: `${group.userId}:${group.roleCode}:outlet:${outletId}`,
          userId: group.userId,
          username: group.username,
          fullName: group.fullName,
          userStatus: group.userStatus,
          roleCode: group.roleCode,
          canonicalRole,
          sourceType,
          legacyCode,
          scopeType: 'outlet',
          scopeId: outletId,
          scopeName: outletsById.get(outletId)?.name || `Outlet ${outletId}`,
          outletIds: [outletId],
          outletCount: 1,
          compatibilityOnly,
        });
      });
  });

  return sortCollapsedAssignments(assignments);
}

export function buildDirectoryMeta(assignments: CollapsedAssignment[]) {
  const byUser = new Map<string, DirectoryUserMeta>();
  const grouped = new Map<string, CollapsedAssignment[]>();
  assignments.forEach((assignment) => {
    const list = grouped.get(assignment.userId) ?? [];
    list.push(assignment);
    grouped.set(assignment.userId, list);
  });

  grouped.forEach((rows, userId) => {
    const ordered = sortCollapsedAssignments(rows);
    const primary = ordered[0];
    const distinctRoles = [...new Set(rows.map((row) => row.canonicalRole))];
    const outletIds = new Set(rows.flatMap((row) => row.outletIds));
    const regionAssignments = rows.filter((row) => row.scopeType === 'region');
    const globalAssignment = rows.find((row) => row.scopeType === 'global');
    const outletAssignments = rows.filter((row) => row.scopeType === 'outlet');
    let scopeSummary = '—';
    if (globalAssignment) {
      scopeSummary = `@ Global (${globalAssignment.outletCount} outlets)`;
    } else if (regionAssignments.length > 0) {
      const first = regionAssignments[0];
      scopeSummary = regionAssignments.length === 1
        ? `~ ${first.scopeName} (${first.outletCount} outlets)`
        : `~ ${first.scopeName} +${regionAssignments.length - 1}`;
    } else if (outletAssignments.length > 0) {
      const first = outletAssignments[0];
      scopeSummary = outletAssignments.length === 1
        ? `* ${first.scopeName}`
        : `* ${first.scopeName} +${outletAssignments.length - 1}`;
    }

    byUser.set(userId, {
      primaryRoleCode: primary?.canonicalRole,
      primaryRoleLabel: primary
        ? ROLE_REFERENCE_COPY[primary.canonicalRole]?.name
          || (primary.compatibilityOnly ? `Compatibility: ${primary.legacyCode || primary.canonicalRole}` : primary.canonicalRole)
        : undefined,
      dominantScopeType: globalAssignment ? 'global' : regionAssignments.length > 0 ? 'region' : outletAssignments.length > 0 ? 'outlet' : undefined,
      additionalRoleCount: Math.max(0, distinctRoles.length - 1),
      scopeSummary,
      legacyLabels: rows
        .filter((row) => row.sourceType === 'legacy' && row.legacyCode && !row.compatibilityOnly)
        .map((row) => `${row.legacyCode} → ${ROLE_REFERENCE_COPY[row.canonicalRole]?.name || row.canonicalRole}`),
      compatibilityOnlyLabels: rows
        .filter((row) => row.compatibilityOnly && row.legacyCode)
        .map((row) => `${row.legacyCode} → Compatibility only`),
      outletCount: outletIds.size,
      hasSuperadmin: rows.some((row) => row.canonicalRole === 'superadmin'),
    });
  });

  return byUser;
}

export function collapseOutletMembership(
  outletIds: string[],
  regions: ScopeRegion[],
  outlets: ScopeOutlet[],
) {
  const uniqueIds = [...new Set(outletIds)];
  const { outletsById, regionsById, regionOutletIds } = buildOutletMaps(regions, outlets);
  const remaining = new Set(uniqueIds);
  const buckets: ScopeBucket[] = [];

  [...regionOutletIds.entries()]
    .sort((a, b) => (regionsById.get(a[0])?.name || a[0]).localeCompare(regionsById.get(b[0])?.name || b[0]))
    .forEach(([regionId, regionOutlets]) => {
      if (regionOutlets.length === 0) return;
      if (!regionOutlets.every((outletId) => remaining.has(outletId))) return;
      regionOutlets.forEach((outletId) => remaining.delete(outletId));
      buckets.push({
        scopeType: 'region',
        scopeId: regionId,
        scopeName: regionsById.get(regionId)?.name || `Region ${regionId}`,
        outletIds: [...regionOutlets],
        outletCount: regionOutlets.length,
      });
    });

  [...remaining]
    .sort((a, b) => (outletsById.get(a)?.name || a).localeCompare(outletsById.get(b)?.name || b))
    .forEach((outletId) => {
      buckets.push({
        scopeType: 'outlet',
        scopeId: outletId,
        scopeName: outletsById.get(outletId)?.name || `Outlet ${outletId}`,
        outletIds: [outletId],
        outletCount: 1,
      });
    });

  return buckets;
}

export function buildFanOutPreview(
  userId: string | null,
  roleCode: string,
  regionId: string,
  assignments: CollapsedAssignment[],
  outlets: ScopeOutlet[],
) {
  const { canonicalRole } = canonicalizeRole(roleCode);
  const rows = outlets
    .filter((outlet) => String(outlet.regionId) === String(regionId))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((outlet) => {
      const alreadyExists = assignments.some((assignment) =>
        assignment.userId === userId
        && assignment.canonicalRole === canonicalRole
        && assignment.outletIds.includes(String(outlet.id)));
      return {
        outletId: String(outlet.id),
        outletCode: outlet.code,
        outletName: outlet.name,
        status: alreadyExists ? 'existing' : 'new',
        note: alreadyExists ? 'Already assigned (no change)' : 'Will be created',
      } satisfies FanOutPreviewRow;
    });
  return rows;
}

function sourceLabel(sourceType: IamSourceType, roleOrPermission: string, legacyCode?: string | null) {
  if (sourceType === 'permission') return `Perm: ${roleOrPermission}`;
  if (sourceType === 'read_floor') return 'Read floor';
  if (sourceType === 'legacy') return `Legacy: ${legacyCode} → ${roleOrPermission}`;
  if (sourceType === 'denied') return 'Denied';
  return `Role: ${roleOrPermission}`;
}

function scopeLabel(scopeType: IamScopeType, scopeName: string, outletCount = 0) {
  if (scopeType === 'global') return `@ ${scopeName}`;
  if (scopeType === 'region') return `~ ${scopeName} (${outletCount} outlets)`;
  return `* ${scopeName}`;
}

function scopeKey(scopeType: IamScopeType, scopeId: string) {
  return `${scopeType}:${scopeId}`;
}

function coversScope(
  row: Pick<EffectiveAccessRow, 'scopeType'> & { scopeId?: string },
  bucket: { scopeType: IamScopeType; scopeId: string },
  outletRegionIds: Map<string, string>,
) {
  if (row.scopeType === 'global') return true;
  if (!row.scopeId) return false;
  if (row.scopeType === bucket.scopeType && row.scopeId === bucket.scopeId) return true;
  if (row.scopeType === 'region' && bucket.scopeType === 'outlet') {
    return row.scopeId === outletRegionIds.get(bucket.scopeId);
  }
  return false;
}

function suggestionText(capabilityId: string) {
  const descriptor = CAPABILITY_CATALOG.find((item) => item.id === capabilityId);
  if (!descriptor) return 'Assign a suitable role or permission to enable this capability.';
  if (descriptor.suggestedPermission) {
    return `To enable: assign ${descriptor.suggestedRole || 'an appropriate role'} or grant ${descriptor.suggestedPermission}.`;
  }
  if (descriptor.suggestedRole) {
    return `To enable: assign ${descriptor.suggestedRole} at the required scope.`;
  }
  return 'Assign a suitable role or permission to enable this capability.';
}

function capabilityMarker(capabilityId: string): RoleComparisonCell['marker'] {
  if (capabilityId === 'superadmin') return 'FULL';
  if (capabilityId.endsWith('.read')) return 'R';
  if (capabilityId.endsWith('.approve')) return 'A';
  return 'W';
}

function capabilitySummaryLabel(domain: string, markers: Set<'R' | 'W' | 'A'>) {
  const ordered = ['R', 'W', 'A'].filter((marker) => markers.has(marker as 'R' | 'W' | 'A'));
  return `${domain} ${ordered.join('+')}`;
}

export function buildLegacyMappingRows(assignments: CollapsedAssignment[]): LegacyMappingRow[] {
  const affectedUsers = new Map<string, Set<string>>();
  assignments
    .filter((assignment) => assignment.sourceType === 'legacy' && assignment.legacyCode)
    .forEach((assignment) => {
      const legacyCode = String(assignment.legacyCode);
      const bucket = affectedUsers.get(legacyCode) ?? new Set<string>();
      bucket.add(assignment.userId);
      affectedUsers.set(legacyCode, bucket);
    });

  const orderedCodes = [
    ...Object.keys(LEGACY_ROLE_ALIASES),
    ...[...affectedUsers.keys()]
      .filter((code) => !Object.prototype.hasOwnProperty.call(LEGACY_ROLE_ALIASES, code))
      .sort((a, b) => a.localeCompare(b)),
  ];

  return orderedCodes.map((legacyCode) => {
    const canonicalRole = LEGACY_ROLE_ALIASES[legacyCode];
    return {
      legacyCode,
      canonicalRole: canonicalRole || undefined,
      canonicalLabel: canonicalRole ? ROLE_REFERENCE_COPY[canonicalRole]?.name || canonicalRole : undefined,
      affectedUserCount: affectedUsers.get(legacyCode)?.size ?? 0,
      status: canonicalRole ? 'mapped' : 'compatibility_only',
    } satisfies LegacyMappingRow;
  });
}

export function buildRoleComparison(roleCodes: string[], roleReferences: RoleReference[]) {
  const roleReferenceByCode = new Map(roleReferences.map((role) => [role.code, role]));
  const selectedRoleCodes = [...new Set(roleCodes)].filter((roleCode) => roleReferenceByCode.has(roleCode));
  const rows = CAPABILITY_CATALOG.map((descriptor) => {
    const cells = selectedRoleCodes.map((roleCode) => {
      const roleReference = roleReferenceByCode.get(roleCode);
      const allowed = roleCode === 'superadmin' || (ROLE_GRANTS[roleCode] ?? []).includes(descriptor.id);
      return {
        roleCode,
        roleName: roleReference?.name || roleCode,
        allowed,
        marker: roleCode === 'superadmin'
          ? 'FULL'
          : allowed
            ? capabilityMarker(descriptor.id)
            : '—',
        scopeType: roleReference?.scopeType || 'outlet',
      } satisfies RoleComparisonCell;
    });
    const differs = new Set(cells.map((cell) => `${cell.marker}:${cell.scopeType}`)).size > 1;
    return {
      id: descriptor.id,
      domain: descriptor.domain,
      capability: descriptor.capability,
      cells,
      differs,
    } satisfies RoleComparisonRow;
  });

  const summary = rows
    .filter((row) => row.differs)
    .slice(0, 6)
    .map((row) => {
      const allowedRoles = row.cells.filter((cell) => cell.allowed).map((cell) => cell.roleName);
      const deniedRoles = row.cells.filter((cell) => !cell.allowed).map((cell) => cell.roleName);
      if (allowedRoles.length > 0 && deniedRoles.length > 0) {
        return `${allowedRoles.join(', ')} include ${row.capability.toLowerCase()}, while ${deniedRoles.join(', ')} do not.`;
      }
      return `${row.capability} differs across the selected roles.`;
    });

  return { rows, summary };
}

export function computeEffectiveAccess(
  userId: string,
  assignments: CollapsedAssignment[],
  overrides: AuthPermissionOverrideView[],
  rawScopes: AuthScopeView[],
  regions: ScopeRegion[],
  outlets: ScopeOutlet[],
) {
  const rows: Array<EffectiveAccessRow & { scopeId?: string }> = [];
  const seen = new Set<string>();
  const userAssignments = assignments.filter((assignment) => assignment.userId === userId);
  const userOverrides = overrides.filter((override) => override.userId === userId);
  const membershipBuckets = collapseOutletMembership(
    rawScopes.filter((row) => row.userId === userId).map((row) => row.outletId),
    regions,
    outlets,
  );
  const outletRegionIds = new Map(outlets.map((outlet) => [String(outlet.id), String(outlet.regionId)]));

  const pushRow = (row: EffectiveAccessRow & { scopeId?: string }) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };

  userAssignments.forEach((assignment) => {
    const grants = ROLE_GRANTS[assignment.canonicalRole] ?? [];
    grants.forEach((capabilityId) => {
      const descriptor = CAPABILITY_CATALOG.find((item) => item.id === capabilityId);
      if (!descriptor) return;
      const source = assignment.sourceType === 'legacy' ? 'legacy' : 'canonical';
      pushRow({
        id: `${assignment.key}:allow:${capabilityId}`,
        domain: descriptor.domain,
        capability: descriptor.capability,
        effect: 'allow',
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        scopeLabel: scopeLabel(assignment.scopeType, assignment.scopeName, assignment.outletCount),
        sourceType: source,
        sourceLabel: sourceLabel(source, assignment.canonicalRole, assignment.legacyCode),
        explanation: assignment.compatibilityOnly
          ? `User has compatibility-only legacy role ${assignment.legacyCode}. This access is preserved for existing accounts, but the role is hidden from the canonical catalog and cannot be newly assigned.`
          : source === 'legacy'
            ? `User has legacy role ${assignment.legacyCode} mapped to canonical role ${assignment.canonicalRole}. Access is equivalent to ${assignment.canonicalRole} at ${assignment.scopeName}.`
          : `${assignment.canonicalRole} role at ${assignment.scopeName} grants ${descriptor.capability.toLowerCase()}. This is the standard access path for this role.`,
        sensitive: Boolean(descriptor.sensitive),
      });
    });

    const limitations = ROLE_LIMITATIONS[assignment.canonicalRole] ?? {};
    Object.entries(limitations).forEach(([capabilityId, reason]) => {
      const descriptor = CAPABILITY_CATALOG.find((item) => item.id === capabilityId);
      if (!descriptor) return;
      pushRow({
        id: `${assignment.key}:deny:${capabilityId}`,
        domain: descriptor.domain,
        capability: descriptor.capability,
        effect: 'deny',
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        scopeLabel: scopeLabel(assignment.scopeType, assignment.scopeName, assignment.outletCount),
        sourceType: 'denied',
        sourceLabel: 'Denied',
        explanation: `${reason} ${suggestionText(capabilityId)}`,
        sensitive: Boolean(descriptor.sensitive),
      });
    });
  });

  userOverrides.forEach((override) => {
    const grants = PERMISSION_GRANTS[override.permissionCode] ?? [];
    grants.forEach((capabilityId) => {
      const descriptor = CAPABILITY_CATALOG.find((item) => item.id === capabilityId);
      if (!descriptor) return;
      pushRow({
        id: `perm:${override.userId}:${override.outletId}:${override.permissionCode}:${capabilityId}`,
        domain: descriptor.domain,
        capability: descriptor.capability,
        effect: 'allow',
        scopeType: 'outlet',
        scopeId: override.outletId,
        scopeLabel: `* ${override.outletName || override.outletCode || override.outletId}`,
        sourceType: 'permission',
        sourceLabel: sourceLabel('permission', override.permissionCode),
        explanation: `Direct permission ${override.permissionCode} granted at ${override.outletName || override.outletCode || override.outletId} provides ${descriptor.capability.toLowerCase()}. This is a fallback grant, not from a role assignment.`,
        sensitive: Boolean(descriptor.sensitive),
      });
    });
  });

  membershipBuckets.forEach((bucket) => {
    READ_FLOOR_CAPABILITY_IDS.forEach((capabilityId) => {
      const descriptor = CAPABILITY_CATALOG.find((item) => item.id === capabilityId);
      if (!descriptor) return;
      pushRow({
        id: `floor:${bucket.scopeType}:${bucket.scopeId}:${capabilityId}`,
        domain: descriptor.domain,
        capability: descriptor.capability,
        effect: 'allow',
        scopeType: bucket.scopeType,
        scopeId: bucket.scopeId,
        scopeLabel: scopeLabel(bucket.scopeType, bucket.scopeName, bucket.outletCount),
        sourceType: 'read_floor',
        sourceLabel: 'Read floor',
        explanation: `User has ${bucket.scopeName} in scope via outlet membership. Basic read access is granted as a read floor and does not include write or approve capabilities.`,
        sensitive: false,
      });
    });
  });

  const relevantScopes = new Map<
    string,
    { scopeType: IamScopeType; scopeId: string; scopeName: string; outletCount: number }
  >();
  userAssignments.forEach((assignment) => {
    relevantScopes.set(scopeKey(assignment.scopeType, assignment.scopeId), {
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      scopeName: assignment.scopeName,
      outletCount: assignment.outletCount,
    });
  });
  membershipBuckets.forEach((bucket) => {
    relevantScopes.set(scopeKey(bucket.scopeType, bucket.scopeId), {
      scopeType: bucket.scopeType,
      scopeId: bucket.scopeId,
      scopeName: bucket.scopeName,
      outletCount: bucket.outletCount,
    });
  });
  userOverrides.forEach((override) => {
    relevantScopes.set(scopeKey('outlet', override.outletId), {
      scopeType: 'outlet',
      scopeId: override.outletId,
      scopeName: override.outletName || override.outletCode || override.outletId,
      outletCount: 1,
    });
  });

  relevantScopes.forEach((bucket) => {
    CAPABILITY_CATALOG.forEach((descriptor) => {
      const alreadyExplained = rows.some((row) =>
        row.capability === descriptor.capability
        && coversScope(row, bucket, outletRegionIds));
      if (alreadyExplained) return;
      pushRow({
        id: `deny:${bucket.scopeType}:${bucket.scopeId}:${descriptor.id}`,
        domain: descriptor.domain,
        capability: descriptor.capability,
        effect: 'deny',
        scopeType: bucket.scopeType,
        scopeId: bucket.scopeId,
        scopeLabel: scopeLabel(bucket.scopeType, bucket.scopeName, bucket.outletCount),
        sourceType: 'denied',
        sourceLabel: 'Denied',
        explanation: `No role or permission grants ${descriptor.capability.toLowerCase()} at ${bucket.scopeName}. ${suggestionText(descriptor.id)}`,
        sensitive: Boolean(descriptor.sensitive),
      });
    });
  });

  return rows.sort((a, b) => {
    const domainDiff = a.domain.localeCompare(b.domain);
    if (domainDiff !== 0) return domainDiff;
    if (a.effect !== b.effect) return a.effect === 'allow' ? -1 : 1;
    return a.capability.localeCompare(b.capability);
  }).map(({ scopeId: _scopeId, ...row }) => row);
}

export function buildOutletAccessRows(
  outletId: string,
  assignments: CollapsedAssignment[],
  overrides: AuthPermissionOverrideView[],
  rawScopes: AuthScopeView[],
  regions: ScopeRegion[],
  outlets: ScopeOutlet[],
  roleReferences: RoleReference[],
): OutletAccessRow[] {
  if (!outletId) return [];

  const outlet = outlets.find((row) => String(row.id) === String(outletId));
  const relevantScopes = rawScopes.filter((row) => String(row.outletId) === String(outletId));
  const relevantUserIds = new Set<string>([
    ...relevantScopes.map((row) => row.userId),
    ...assignments
      .filter((assignment) => assignment.scopeType === 'global' || assignment.outletIds.includes(String(outletId)))
      .map((assignment) => assignment.userId),
    ...overrides
      .filter((override) => String(override.outletId) === String(outletId))
      .map((override) => override.userId),
  ]);

  const roleReferenceByCode = new Map(roleReferences.map((role) => [role.code, role]));
  const rows = [...relevantUserIds].map((userId) => {
    const userScopeRows = rawScopes.filter((row) => row.userId === userId);
    const userAssignments = assignments.filter((assignment) =>
      assignment.userId === userId && (assignment.scopeType === 'global' || assignment.outletIds.includes(String(outletId))));
    const userOverrides = overrides.filter((override) =>
      override.userId === userId && String(override.outletId) === String(outletId));
    const accessRows = computeEffectiveAccess(userId, assignments, overrides, rawScopes, regions, outlets).filter((row) => {
      if (row.effect !== 'allow') return false;
      if (row.scopeType === 'global') return true;
      if (row.scopeType === 'outlet') return row.scopeLabel === `* ${outlet?.name || outlet?.code || outletId}`;
      return row.scopeLabel.startsWith(`~ ${(regions.find((region) => String(region.id) === String(outlet?.regionId))?.name || '')}`);
    });

    const userRecord = userScopeRows[0] || userAssignments[0];
    const domainMarkers = new Map<string, Set<'R' | 'W' | 'A'>>();
    accessRows.forEach((row) => {
      const descriptor = CAPABILITY_CATALOG.find((item) => item.capability === row.capability);
      if (!descriptor) return;
      const marker = capabilityMarker(descriptor.id);
      if (marker === 'FULL' || marker === '—') return;
      const bucket = domainMarkers.get(row.domain) ?? new Set<'R' | 'W' | 'A'>();
      bucket.add(marker);
      domainMarkers.set(row.domain, bucket);
    });

    const roleLabels = [...new Set(userAssignments.map((assignment) =>
      roleReferenceByCode.get(assignment.canonicalRole)?.name || assignment.canonicalRole))];
    const scopeLabels = [...new Set(userAssignments.map((assignment) => scopeLabel(assignment.scopeType, assignment.scopeName, assignment.outletCount)))];
    const sourceTypes = new Set<IamSourceType>();
    if (userAssignments.some((assignment) => assignment.sourceType === 'canonical')) sourceTypes.add('canonical');
    if (userAssignments.some((assignment) => assignment.sourceType === 'legacy')) sourceTypes.add('legacy');
    if (userOverrides.length > 0) sourceTypes.add('permission');
    if (relevantScopes.some((row) => row.userId === userId)) sourceTypes.add('read_floor');

    return {
      userId,
      username: userRecord?.username || `user-${userId}`,
      fullName: userRecord?.fullName || userRecord?.username || `User ${userId}`,
      userStatus: userRecord?.userStatus,
      roleLabels: roleLabels.length > 0 ? roleLabels : ['(no role)'],
      scopeLabels: scopeLabels.length > 0 ? scopeLabels : [`* ${outlet?.name || outletId}`],
      domainAccessSummary: [...domainMarkers.entries()].map(([domain, markers]) => capabilitySummaryLabel(domain, markers)),
      sourceTypes: [...sourceTypes].sort(),
    } satisfies OutletAccessRow;
  });

  return rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
