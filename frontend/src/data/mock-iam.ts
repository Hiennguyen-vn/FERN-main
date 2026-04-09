import type { IAMUser, IAMRole, IAMPermission, IAMScope, PermissionOverride, EffectiveAccessEntry, AuthFailure } from '@/types/iam';

export const mockIAMUsers: IAMUser[] = [
  { id: 'usr-001', fullName: 'Sarah Chen', username: 'sarah.chen', email: 'sarah.chen@company.com', persona: 'System Administrator', status: 'active', scopeSummary: 'System-wide', lastLogin: '2025-01-15T09:22:00Z', roles: ['system-admin'], createdAt: '2024-03-01' },
  { id: 'usr-002', fullName: 'Marcus Rivera', username: 'marcus.r', email: 'marcus.r@company.com', persona: 'Regional Manager', status: 'active', scopeSummary: 'Central Region', lastLogin: '2025-01-15T08:45:00Z', roles: ['regional-manager', 'report-viewer'], createdAt: '2024-04-12' },
  { id: 'usr-003', fullName: 'Aisha Patel', username: 'aisha.p', email: 'aisha.p@company.com', persona: 'Outlet Manager', status: 'active', scopeSummary: 'Downtown Flagship', lastLogin: '2025-01-14T17:30:00Z', roles: ['outlet-manager'], createdAt: '2024-05-20' },
  { id: 'usr-004', fullName: 'James Okonkwo', username: 'james.o', email: 'james.o@company.com', persona: 'POS Cashier', status: 'active', scopeSummary: 'Riverside Branch', lastLogin: '2025-01-15T07:00:00Z', roles: ['pos-operator'], createdAt: '2024-08-10' },
  { id: 'usr-005', fullName: 'Elena Vasquez', username: 'elena.v', email: 'elena.v@company.com', persona: 'Finance Lead', status: 'active', scopeSummary: 'System-wide', lastLogin: '2025-01-14T16:20:00Z', roles: ['finance-lead', 'report-viewer'], createdAt: '2024-03-15' },
  { id: 'usr-006', fullName: 'David Kim', username: 'david.k', email: 'david.k@company.com', persona: 'Procurement Officer', status: 'suspended', scopeSummary: 'North Region', lastLogin: '2025-01-10T11:00:00Z', roles: ['procurement-officer'], createdAt: '2024-06-01' },
  { id: 'usr-007', fullName: 'Fatima Al-Hassan', username: 'fatima.ah', email: 'fatima.ah@company.com', persona: 'HR Reviewer', status: 'active', scopeSummary: 'System-wide', lastLogin: '2025-01-15T09:10:00Z', roles: ['hr-reviewer'], createdAt: '2024-04-01' },
  { id: 'usr-008', fullName: 'Tom Bradley', username: 'tom.b', email: 'tom.b@company.com', persona: 'Audit Viewer', status: 'locked', scopeSummary: 'Central Region', lastLogin: '2025-01-08T14:00:00Z', roles: ['audit-viewer'], createdAt: '2024-07-15' },
];

export const mockIAMRoles: IAMRole[] = [
  { id: 'role-001', name: 'system-admin', description: 'Full system access with all administrative privileges', permissionCount: 84, userCount: 1, builtIn: true, createdAt: '2024-01-01' },
  { id: 'role-002', name: 'regional-manager', description: 'Regional operations management with cross-outlet visibility', permissionCount: 52, userCount: 3, builtIn: true, createdAt: '2024-01-01' },
  { id: 'role-003', name: 'outlet-manager', description: 'Full outlet operations including POS, inventory, and reporting', permissionCount: 38, userCount: 6, builtIn: true, createdAt: '2024-01-01' },
  { id: 'role-004', name: 'pos-operator', description: 'Point of sale operations: sessions, orders, payments', permissionCount: 12, userCount: 24, builtIn: true, createdAt: '2024-01-01' },
  { id: 'role-005', name: 'finance-lead', description: 'Finance operations including payroll and configuration', permissionCount: 28, userCount: 2, builtIn: true, createdAt: '2024-01-01' },
  { id: 'role-006', name: 'procurement-officer', description: 'Purchase orders, supplier management, goods receipts', permissionCount: 18, userCount: 4, builtIn: false, createdAt: '2024-03-10' },
  { id: 'role-007', name: 'report-viewer', description: 'Read-only access to reports and analytics dashboards', permissionCount: 8, userCount: 12, builtIn: true, createdAt: '2024-01-01' },
  { id: 'role-008', name: 'hr-reviewer', description: 'Attendance review and approval queues', permissionCount: 14, userCount: 2, builtIn: false, createdAt: '2024-04-01' },
  { id: 'role-009', name: 'audit-viewer', description: 'Read-only access to audit trail and security events', permissionCount: 6, userCount: 3, builtIn: true, createdAt: '2024-01-01' },
];

export const mockIAMPermissions: IAMPermission[] = [
  // POS
  { code: 'pos.session.read', module: 'pos', description: 'View POS sessions', published: true, assignedRoleCount: 5 },
  { code: 'pos.session.write', module: 'pos', description: 'Open/close POS sessions', published: true, assignedRoleCount: 3 },
  { code: 'pos.order.read', module: 'pos', description: 'View sale orders', published: true, assignedRoleCount: 5 },
  { code: 'pos.order.write', module: 'pos', description: 'Create/modify sale orders', published: true, assignedRoleCount: 3 },
  { code: 'pos.payment.capture', module: 'pos', description: 'Capture payments', published: true, assignedRoleCount: 3 },
  { code: 'pos.table.read', module: 'pos', description: 'View table assignments', published: false, assignedRoleCount: 0 },
  { code: 'pos.table.write', module: 'pos', description: 'Assign/release tables', published: false, assignedRoleCount: 0 },
  { code: 'pos.table.manage', module: 'pos', description: 'Manage table configuration', published: false, assignedRoleCount: 0 },
  // Catalog
  { code: 'catalog.product.read', module: 'catalog', description: 'View products', published: true, assignedRoleCount: 7 },
  { code: 'catalog.product.write', module: 'catalog', description: 'Create/edit products', published: true, assignedRoleCount: 2 },
  { code: 'catalog.recipe.read', module: 'catalog', description: 'View recipes', published: true, assignedRoleCount: 5 },
  { code: 'catalog.recipe.write', module: 'catalog', description: 'Create/edit recipes', published: true, assignedRoleCount: 2 },
  { code: 'catalog.pricing.read', module: 'catalog', description: 'View pricing rules', published: true, assignedRoleCount: 5 },
  { code: 'catalog.pricing.write', module: 'catalog', description: 'Modify pricing rules', published: true, assignedRoleCount: 1 },
  // Inventory
  { code: 'inventory.stock.read', module: 'inventory', description: 'View stock levels', published: true, assignedRoleCount: 6 },
  { code: 'inventory.stock.write', module: 'inventory', description: 'Adjust stock', published: true, assignedRoleCount: 3 },
  { code: 'inventory.count.manage', module: 'inventory', description: 'Manage stock counts', published: true, assignedRoleCount: 3 },
  // Procurement
  { code: 'procurement.po.read', module: 'procurement', description: 'View purchase orders', published: true, assignedRoleCount: 5 },
  { code: 'procurement.po.write', module: 'procurement', description: 'Create/edit purchase orders', published: true, assignedRoleCount: 3 },
  { code: 'procurement.po.approve', module: 'procurement', description: 'Approve purchase orders', published: true, assignedRoleCount: 2 },
  // Finance
  { code: 'finance.payroll.read', module: 'finance', description: 'View payroll data', published: true, assignedRoleCount: 3 },
  { code: 'finance.payroll.write', module: 'finance', description: 'Create/modify payroll runs', published: true, assignedRoleCount: 2 },
  { code: 'finance.payroll.approve', module: 'finance', description: 'Approve payroll runs', published: true, assignedRoleCount: 1 },
  { code: 'finance.config.manage', module: 'finance', description: 'Manage finance configuration', published: true, assignedRoleCount: 1 },
  // Reports
  { code: 'reports.revenue.read', module: 'reports', description: 'View revenue reports', published: true, assignedRoleCount: 5 },
  { code: 'reports.export', module: 'reports', description: 'Export report data', published: true, assignedRoleCount: 3 },
  // Audit
  { code: 'audit.trail.read', module: 'audit', description: 'View audit trail', published: true, assignedRoleCount: 4 },
  { code: 'audit.security.read', module: 'audit', description: 'View security events', published: true, assignedRoleCount: 2 },
  // IAM
  { code: 'iam.user.read', module: 'iam', description: 'View user accounts', published: true, assignedRoleCount: 2 },
  { code: 'iam.user.write', module: 'iam', description: 'Create/modify user accounts', published: true, assignedRoleCount: 1 },
  { code: 'iam.role.read', module: 'iam', description: 'View roles', published: true, assignedRoleCount: 2 },
  { code: 'iam.role.write', module: 'iam', description: 'Create/modify roles', published: true, assignedRoleCount: 1 },
  { code: 'iam.override.manage', module: 'iam', description: 'Manage permission overrides', published: true, assignedRoleCount: 1 },
];

export const mockIAMScopes: IAMScope[] = [
  { userId: 'usr-001', userName: 'Sarah Chen', scopeLevel: 'system', scopeId: 'system', scopeName: 'System-wide', assignedAt: '2024-03-01' },
  { userId: 'usr-002', userName: 'Marcus Rivera', scopeLevel: 'region', scopeId: 'region-central', scopeName: 'Central Region', assignedAt: '2024-04-12' },
  { userId: 'usr-003', userName: 'Aisha Patel', scopeLevel: 'outlet', scopeId: 'outlet-001', scopeName: 'Downtown Flagship', assignedAt: '2024-05-20' },
  { userId: 'usr-004', userName: 'James Okonkwo', scopeLevel: 'outlet', scopeId: 'outlet-002', scopeName: 'Riverside Branch', assignedAt: '2024-08-10' },
  { userId: 'usr-005', userName: 'Elena Vasquez', scopeLevel: 'system', scopeId: 'system', scopeName: 'System-wide', assignedAt: '2024-03-15' },
  { userId: 'usr-006', userName: 'David Kim', scopeLevel: 'region', scopeId: 'region-north', scopeName: 'North Region', assignedAt: '2024-06-01' },
  { userId: 'usr-007', userName: 'Fatima Al-Hassan', scopeLevel: 'system', scopeId: 'system', scopeName: 'System-wide', assignedAt: '2024-04-01' },
  { userId: 'usr-008', userName: 'Tom Bradley', scopeLevel: 'region', scopeId: 'region-central', scopeName: 'Central Region', assignedAt: '2024-07-15' },
];

export const mockOverrides: PermissionOverride[] = [
  { id: 'ovr-001', userId: 'usr-003', userName: 'Aisha Patel', permission: 'procurement.po.approve', effect: 'grant', reason: 'Temporary approval authority while Regional Manager is on leave', createdBy: 'Sarah Chen', createdAt: '2025-01-10', expiresAt: '2025-02-10' },
  { id: 'ovr-002', userId: 'usr-006', userName: 'David Kim', permission: 'procurement.po.write', effect: 'deny', reason: 'Account under review — procurement access revoked pending investigation', createdBy: 'Sarah Chen', createdAt: '2025-01-12', expiresAt: null },
  { id: 'ovr-003', userId: 'usr-004', userName: 'James Okonkwo', permission: 'reports.export', effect: 'grant', reason: 'Granted export access for end-of-month reporting cycle', createdBy: 'Marcus Rivera', createdAt: '2025-01-14', expiresAt: '2025-01-31' },
];

export const mockEffectiveAccess: EffectiveAccessEntry[] = [
  { permission: 'pos.session.read', module: 'pos', source: 'role', sourceName: 'outlet-manager', effect: 'allow', published: true },
  { permission: 'pos.session.write', module: 'pos', source: 'role', sourceName: 'outlet-manager', effect: 'allow', published: true },
  { permission: 'pos.order.read', module: 'pos', source: 'role', sourceName: 'outlet-manager', effect: 'allow', published: true },
  { permission: 'pos.order.write', module: 'pos', source: 'role', sourceName: 'outlet-manager', effect: 'allow', published: true },
  { permission: 'pos.table.read', module: 'pos', source: 'role', sourceName: '—', effect: 'deny', published: false },
  { permission: 'pos.table.write', module: 'pos', source: 'role', sourceName: '—', effect: 'deny', published: false },
  { permission: 'pos.table.manage', module: 'pos', source: 'role', sourceName: '—', effect: 'deny', published: false },
  { permission: 'procurement.po.approve', module: 'procurement', source: 'override', sourceName: 'Temporary grant', effect: 'allow', published: true },
  { permission: 'catalog.product.read', module: 'catalog', source: 'role', sourceName: 'outlet-manager', effect: 'allow', published: true },
  { permission: 'inventory.stock.read', module: 'inventory', source: 'role', sourceName: 'outlet-manager', effect: 'allow', published: true },
  { permission: 'inventory.stock.write', module: 'inventory', source: 'role', sourceName: 'outlet-manager', effect: 'allow', published: true },
  { permission: 'reports.revenue.read', module: 'reports', source: 'role', sourceName: 'outlet-manager', effect: 'allow', published: true },
  { permission: 'finance.payroll.read', module: 'finance', source: 'role', sourceName: '—', effect: 'deny', published: true },
];

export const mockAuthFailures: AuthFailure[] = [
  { id: 'af-001', username: 'tom.b', ip: '192.168.1.45', reason: 'Invalid password — account locked after 5 attempts', timestamp: '2025-01-08T14:02:00Z' },
  { id: 'af-002', username: 'unknown_user', ip: '10.0.0.99', reason: 'Username not found', timestamp: '2025-01-14T03:15:00Z' },
  { id: 'af-003', username: 'david.k', ip: '172.16.0.12', reason: 'Account suspended', timestamp: '2025-01-13T09:30:00Z' },
  { id: 'af-004', username: 'sarah.chen', ip: '192.168.1.10', reason: 'Expired session token', timestamp: '2025-01-15T06:00:00Z' },
];
