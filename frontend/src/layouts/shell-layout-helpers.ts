import type { AuthBusinessScopeView, AuthSession } from '@/api/auth-api';
import { hasModuleAccess } from '@/auth/authorization';
import type {
  ActionHub,
  ModuleEntry,
  ModuleFamily,
  ScopeLevel,
  ScopeOption,
  ShellContext,
  ShellScope,
} from '@/types/shell';

export const FAMILY_TO_PATH: Record<ModuleFamily, string> = {
  home: '/dashboard',
  pos: '/pos',
  inventory: '/inventory',
  procurement: '/procurement',
  catalog: '/catalog',
  reports: '/reports',
  audit: '/audit',
  iam: '/iam',
  finance: '/finance',
  hr: '/hr',
  settings: '/settings',
  crm: '/crm',
  promotions: '/promotions',
  scheduling: '/scheduling',
  workforce: '/workforce',
  org: '/org/overview',
  'regional-ops': '/reports',
};

export const PATH_TO_FAMILY: Record<string, string> = Object.fromEntries(
  Object.entries(FAMILY_TO_PATH).map(([family, path]) => [path, family]),
);
PATH_TO_FAMILY['/org'] = 'org';
PATH_TO_FAMILY['/settings'] = 'org';

export const ROUTE_FAMILIES = Object.keys(FAMILY_TO_PATH) as ModuleFamily[];

export const MODULES: ModuleEntry[] = [
  { family: 'home', label: 'Dashboard', icon: 'LayoutDashboard', path: '/dashboard', visible: true },
  { family: 'pos', label: 'POS', icon: 'Monitor', path: '/pos', visible: true },
  { family: 'catalog', label: 'Catalog', icon: 'Package', path: '/catalog', visible: true },
  { family: 'inventory', label: 'Inventory', icon: 'Warehouse', path: '/inventory', visible: true },
  { family: 'procurement', label: 'Procurement', icon: 'ShoppingCart', path: '/procurement', visible: true },
  { family: 'finance', label: 'Finance', icon: 'Landmark', path: '/finance', visible: true },
  { family: 'hr', label: 'HR', icon: 'Users', path: '/hr', visible: true },
  { family: 'workforce', label: 'Workforce', icon: 'Users', path: '/workforce', visible: true },
  { family: 'org', label: 'Organization', icon: 'Building2', path: '/org/overview', visible: true },
  { family: 'regional-ops', label: 'Regional Ops', icon: 'Map', path: '/reports', visible: true },
  { family: 'reports', label: 'Reports', icon: 'BarChart3', path: '/reports', visible: true },
  { family: 'audit', label: 'Audit', icon: 'ScrollText', path: '/audit', visible: true },
  { family: 'iam', label: 'IAM', icon: 'Shield', path: '/iam', visible: true },
];

export const ACTION_HUB: ActionHub = {
  quickActions: [
    { id: 'new-sale', label: 'New Sale', icon: 'Plus', module: 'pos', path: '/pos', scope: ['outlet'] },
    { id: 'stock-count', label: 'Stock Count', icon: 'ClipboardCheck', module: 'inventory', path: '/inventory', scope: ['outlet'] },
    { id: 'new-po', label: 'Create PO', icon: 'FileText', module: 'procurement', path: '/procurement', scope: ['outlet', 'region'] },
    { id: 'record-gr', label: 'Record GR', icon: 'PackagePlus', module: 'procurement', path: '/procurement', scope: ['outlet'] },
    { id: 'approve-payroll', label: 'Approve Payroll', icon: 'CheckCircle', module: 'finance', path: '/finance', scope: ['region', 'system'] },
  ],
  recentItems: [
    { label: 'Latest POS sessions', path: '/pos', module: 'pos' },
    { label: 'Low stock alerts', path: '/reports', module: 'reports' },
  ],
};

function normalizeScopeId(value: string | null | undefined) {
  return String(value ?? '').trim();
}

function buildOutletScopeOption(
  outlet: { id: string; regionId: string; code: string; name: string },
  parentRegionId: string,
): ScopeOption {
  return {
    id: outlet.id,
    name: `${outlet.code} · ${outlet.name}`,
    level: 'outlet',
    parentId: parentRegionId,
  };
}

function sortScopeTreeChildren(nodes: ScopeOption[]) {
  return [...nodes].sort((a, b) => a.name.localeCompare(b.name));
}

function computeFullScopeTree(
  regions: Array<{ id: string; name: string }>,
  outlets: Array<{ id: string; regionId: string; code: string; name: string }>,
): ScopeOption[] {
  const regionsById = new Map<string, ScopeOption>();
  regions.forEach((region) => {
    regionsById.set(region.id, {
      id: region.id,
      name: region.name,
      level: 'region',
      parentId: 'system',
      children: [],
    });
  });

  outlets.forEach((outlet) => {
    let parent = regionsById.get(outlet.regionId);
    if (!parent) {
      parent = {
        id: outlet.regionId || `unknown-region-${outlet.id}`,
        name: outlet.regionId ? `Region ${outlet.regionId}` : 'Unassigned Region',
        level: 'region',
        parentId: 'system',
        children: [],
      };
      regionsById.set(parent.id, parent);
    }
    (parent.children ??= []).push(buildOutletScopeOption(outlet, parent.id));
  });

  const children = Array.from(regionsById.values()).map((region) => ({
    ...region,
    children: sortScopeTreeChildren(region.children ?? []),
  }));

  return [
    {
      id: 'system',
      name: 'All Regions',
      level: 'system',
      children: sortScopeTreeChildren(children),
    },
  ];
}

function computeAssignedScopeTree(
  regions: Array<{ id: string; name: string }>,
  outlets: Array<{ id: string; regionId: string; code: string; name: string }>,
  scopeAssignments: AuthBusinessScopeView[],
): ScopeOption[] {
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  const outletsById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const rootRegions = new Map<string, ScopeOption>();
  const coveredOutletIds = new Set<string>();

  const ensureRootRegion = (regionId: string) => {
    const existing = rootRegions.get(regionId);
    if (existing) return existing;
    const region = regionsById.get(regionId);
    const created: ScopeOption = {
      id: regionId,
      name: region?.name || `Region ${regionId}`,
      level: 'region',
      parentId: 'system',
      children: [],
    };
    rootRegions.set(regionId, created);
    return created;
  };

  for (const assignment of scopeAssignments) {
    if (assignment.scopeType !== 'region') continue;
    const regionId = normalizeScopeId(assignment.scopeId);
    if (!regionId) continue;
    const root = ensureRootRegion(regionId);
    for (const outletIdValue of assignment.outletIds ?? []) {
      const outletId = normalizeScopeId(outletIdValue);
      const outlet = outletsById.get(outletId);
      if (!outlet) continue;
      coveredOutletIds.add(outlet.id);
      if ((root.children ?? []).some((child) => child.id === outlet.id)) continue;
      (root.children ??= []).push(buildOutletScopeOption(outlet, regionId));
    }
  }

  for (const assignment of scopeAssignments) {
    if (assignment.scopeType !== 'outlet') continue;
    const outletIds = assignment.outletIds?.length
      ? assignment.outletIds
      : assignment.scopeId
        ? [assignment.scopeId]
        : [];
    for (const outletIdValue of outletIds) {
      const outletId = normalizeScopeId(outletIdValue);
      if (!outletId || coveredOutletIds.has(outletId)) continue;
      const outlet = outletsById.get(outletId);
      if (!outlet) continue;
      const root = ensureRootRegion(outlet.regionId);
      coveredOutletIds.add(outlet.id);
      if ((root.children ?? []).some((child) => child.id === outlet.id)) continue;
      (root.children ??= []).push(buildOutletScopeOption(outlet, root.id));
    }
  }

  if (rootRegions.size === 0) {
    return computeFullScopeTree(regions, outlets);
  }

  const children = Array.from(rootRegions.values()).map((region) => ({
    ...region,
    children: sortScopeTreeChildren(region.children ?? []),
  }));

  return [
    {
      id: 'system',
      name: 'All Regions',
      level: 'system',
      children: sortScopeTreeChildren(children),
    },
  ];
}

export function computeScopeTree(
  regions: Array<{ id: string; name: string }>,
  outlets: Array<{ id: string; regionId: string; code: string; name: string }>,
  scopeAssignments?: AuthBusinessScopeView[],
): ScopeOption[] {
  const normalizedAssignments = (scopeAssignments ?? []).filter((assignment) => normalizeScopeId(assignment.scopeType));
  const hasGlobalScope = normalizedAssignments.some((assignment) => assignment.scopeType === 'global');
  if (normalizedAssignments.length === 0 || hasGlobalScope) {
    return computeFullScopeTree(regions, outlets);
  }
  return computeAssignedScopeTree(regions, outlets, normalizedAssignments);
}

export function defaultScope(level: ScopeLevel, scopeTree: ScopeOption[]): ShellScope {
  const firstRegion = scopeTree[0]?.children?.[0];
  const firstOutlet = firstRegion?.children?.[0];
  if (level === 'system' || !firstRegion) return { level: 'system' };
  if (level === 'region' || !firstOutlet) {
    return { level: 'region', regionId: firstRegion.id, regionName: firstRegion.name };
  }
  return {
    level: 'outlet',
    regionId: firstRegion.id,
    regionName: firstRegion.name,
    outletId: firstOutlet.id,
    outletName: firstOutlet.name,
  };
}

export function buildShellUser(session: AuthSession | null | undefined): ShellContext['user'] {
  const source = session?.user;
  const displayName = source?.fullName || source?.username || 'Operator';
  return {
    id: source?.id || 'unknown',
    displayName,
    email: source?.email || 'unknown@fern.local',
    persona: source?.status || 'active',
    avatarInitials: displayName
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'OP',
  };
}

export function collectAccessibleFamilies(session: AuthSession | null | undefined): Set<ModuleFamily> {
  return new Set(ROUTE_FAMILIES.filter((family) => hasModuleAccess(session ?? null, family)));
}

export function filterAccessibleModules(session: AuthSession | null | undefined): ModuleEntry[] {
  return MODULES.filter((module) => hasModuleAccess(session ?? null, module.family)).map((module) => ({
    ...module,
    visible: true,
  }));
}

export function filterActionHub(session: AuthSession | null | undefined): ActionHub {
  const accessibleFamilies = collectAccessibleFamilies(session);
  return {
    quickActions: ACTION_HUB.quickActions.filter((action) => accessibleFamilies.has(action.module)),
    recentItems: ACTION_HUB.recentItems.filter((item) => accessibleFamilies.has(item.module)),
  };
}
