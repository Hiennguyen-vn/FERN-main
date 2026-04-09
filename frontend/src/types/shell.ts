// Shell types derived from gateway contracts

export type ScopeLevel = 'system' | 'region' | 'outlet';

export interface ShellScope {
  level: ScopeLevel;
  regionId?: string;
  regionName?: string;
  outletId?: string;
  outletName?: string;
}

export interface ScopeOption {
  id: string;
  name: string;
  level: ScopeLevel;
  parentId?: string;
  children?: ScopeOption[];
}

export type ModuleFamily =
  | 'home' | 'pos' | 'catalog' | 'iam' | 'audit'
  | 'org' | 'regional-ops' | 'hr' | 'finance'
  | 'procurement' | 'inventory' | 'workforce' | 'reports'
  | 'settings'
  | 'crm' | 'promotions' | 'scheduling';

export interface ModuleEntry {
  family: ModuleFamily;
  label: string;
  icon: string;
  path: string;
  visible: boolean;
  children?: ModuleEntry[];
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  module: ModuleFamily;
  path: string;
  scope?: ScopeLevel[];
}

export interface ShellContext {
  user: {
    id: string;
    displayName: string;
    email: string;
    persona: string;
    avatarInitials: string;
  };
  scope: ShellScope;
  availableScopes: ScopeOption[];
  modules: ModuleEntry[];
  permissions: string[];
}

export interface ActionHub {
  quickActions: QuickAction[];
  recentItems: { label: string; path: string; module: ModuleFamily }[];
}

export type AuthErrorType =
  | 'invalid_credentials'
  | 'account_locked'
  | 'account_suspended'
  | 'gateway_misconfigured'
  | 'service_unavailable'
  | 'branch_blocked';

export type ServiceStatus = 'available' | 'unavailable' | 'degraded' | 'branch_blocked';

export type PermissionState =
  | 'full_access'
  | 'read_only'
  | 'action_disabled'
  | 'field_masked'
  | 'export_unavailable'
  | 'scope_mismatch'
  | 'route_unavailable'
  | 'service_unavailable'
  | 'branch_blocked'
  | 'hidden';
