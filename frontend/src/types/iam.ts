// IAM administration types — aligned to gateway contracts

export type UserStatus = 'active' | 'suspended' | 'locked' | 'deactivated';

export interface IAMUser {
  id: string;
  fullName: string;
  username: string;
  email: string;
  persona: string;
  status: UserStatus;
  scopeSummary: string;
  lastLogin: string | null;
  roles: string[];
  createdAt: string;
}

export interface IAMRole {
  id: string;
  name: string;
  description: string;
  permissionCount: number;
  userCount: number;
  builtIn: boolean;
  createdAt: string;
}

export interface IAMPermission {
  code: string;
  module: string;
  description: string;
  published: boolean;        // whether the permission has been bootstrapped
  assignedRoleCount: number;
}

export interface IAMScope {
  userId: string;
  userName: string;
  scopeLevel: 'system' | 'region' | 'outlet';
  scopeId: string;
  scopeName: string;
  assignedAt: string;
}

export interface PermissionOverride {
  id: string;
  userId: string;
  userName: string;
  permission: string;
  effect: 'grant' | 'deny';
  reason: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface EffectiveAccessEntry {
  permission: string;
  module: string;
  source: 'role' | 'override' | 'scope';
  sourceName: string;
  effect: 'allow' | 'deny';
  published: boolean;
}

export interface AuthFailure {
  id: string;
  username: string;
  ip: string;
  reason: string;
  timestamp: string;
}
