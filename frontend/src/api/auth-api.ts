import { apiRequest, type PagedResponse } from '@/api/client';
import { decodeArray, decodePaged } from '@/api/decoders';
import { COOKIE_AUTH_TOKEN_SENTINEL } from '@/auth/session';
import {
  asBoolean,
  asId,
  asIsoDateTime,
  asNullableString,
  asRecord,
  asRecordArray,
  asString,
  asStringArray,
} from '@/api/records';

export interface FernUser {
  id: string;
  username: string;
  fullName: string;
  employeeCode?: string | null;
  email?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface AuthSession {
  accessToken: string;
  sessionId: string;
  user: FernUser;
  rolesByOutlet: Record<string, string[]>;
  permissionsByOutlet: Record<string, string[]>;
  scopeAssignments?: AuthBusinessScopeView[];
  issuedAt?: string;
  expiresAt?: string;
}

export interface AuthSessionRow {
  sessionId: string;
  state?: string | null;
  current?: boolean;
  issuedAt?: string | null;
  expiresAt?: string | null;
  refreshedAt?: string | null;
  revokedAt?: string | null;
  revokedByUserId?: string | null;
  revokeReason?: string | null;
  userAgent?: string | null;
  clientIp?: string | null;
  [key: string]: unknown;
}

export interface AuthUserListItem extends FernUser {
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AuthScopeView {
  userId: string;
  username: string;
  fullName: string;
  userStatus?: string | null;
  outletId: string;
  outletCode?: string | null;
  outletName?: string | null;
  roles: string[];
  permissions: string[];
}

export interface AuthPermissionOverrideView {
  userId: string;
  username: string;
  fullName: string;
  userStatus?: string | null;
  outletId: string;
  outletCode?: string | null;
  outletName?: string | null;
  permissionCode: string;
  permissionName?: string | null;
  assignedAt?: string | null;
}

export interface AuthBusinessScopeView {
  scopeType: string;
  scopeId?: string | null;
  scopeCode?: string | null;
  roles: string[];
  outletIds: string[];
}

export interface AuthPermissionCatalogItem {
  code: string;
  name?: string | null;
  description?: string | null;
  module?: string | null;
  published: boolean;
  assignedRoleCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AuthRoleCatalogItem {
  code: string;
  name?: string | null;
  description?: string | null;
  published: boolean;
  assignedPermissionCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AuthBusinessRoleCatalogItem {
  code: string;
  name?: string | null;
  description?: string | null;
  scopeType?: string | null;
  aliases: string[];
}

export interface AuthUsersQuery {
  q?: string;
  username?: string;
  status?: string;
  outletId?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AuthScopesQuery {
  q?: string;
  userId?: string;
  username?: string;
  outletId?: string;
  status?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AuthOverridesQuery {
  q?: string;
  userId?: string;
  username?: string;
  outletId?: string;
  permissionCode?: string;
  status?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AuthPermissionsQuery {
  q?: string;
  module?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AuthRolesQuery {
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CreateAuthUserPayload {
  username: string;
  password: string;
  fullName: string;
  employeeCode?: string | null;
  email?: string | null;
  roleCodes?: string[];
  permissionCodes?: string[];
  outletAccess?: Array<{
    outletId: string;
    roles?: string[];
    permissions?: string[];
  }>;
  scopeAssignments?: Array<{
    scopeType: string;
    scopeId: string;
    roles?: string[];
    permissions?: string[];
  }>;
}

function decodeUser(value: unknown): FernUser {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    username: asString(record.username),
    fullName: asString(record.fullName ?? record.username ?? 'Unknown user'),
    employeeCode: asNullableString(record.employeeCode),
    email: asNullableString(record.email),
    status: asNullableString(record.status),
  };
}

function decodeRolesByOutlet(value: unknown): Record<string, string[]> {
  const record = asRecord(value) ?? {};
  return Object.fromEntries(
    Object.entries(record).map(([outletId, roles]) => [asId(outletId), asStringArray(roles)]),
  );
}

function decodeAuthSession(value: unknown): AuthSession {
  const record = asRecord(value) ?? {};
  return {
    accessToken: COOKIE_AUTH_TOKEN_SENTINEL,
    sessionId: asString(record.sessionId),
    user: decodeUser(record.user),
    rolesByOutlet: decodeRolesByOutlet(record.rolesByOutlet),
    permissionsByOutlet: decodeRolesByOutlet(record.permissionsByOutlet),
    scopeAssignments: asRecordArray(record.scopeAssignments).map(decodeBusinessScope),
    issuedAt: asIsoDateTime(record.issuedAt) ?? undefined,
    expiresAt: asIsoDateTime(record.expiresAt) ?? undefined,
  };
}

function decodeSessionRow(value: unknown): AuthSessionRow {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    sessionId: asString(record.sessionId),
    state: asNullableString(record.state),
    current: asBoolean(record.current),
    issuedAt: asIsoDateTime(record.issuedAt),
    expiresAt: asIsoDateTime(record.expiresAt),
    refreshedAt: asIsoDateTime(record.refreshedAt),
    revokedAt: asIsoDateTime(record.revokedAt),
    revokedByUserId: record.revokedByUserId === null || record.revokedByUserId === undefined ? null : asId(record.revokedByUserId),
    revokeReason: asNullableString(record.revokeReason),
    userAgent: asNullableString(record.userAgent),
    clientIp: asNullableString(record.clientIp),
  };
}

function decodeAuthUserListItem(value: unknown): AuthUserListItem {
  const record = asRecord(value) ?? {};
  return {
    ...decodeUser(record),
    createdAt: asIsoDateTime(record.createdAt),
    updatedAt: asIsoDateTime(record.updatedAt),
  };
}

function decodeAuthScope(value: unknown): AuthScopeView {
  const record = asRecord(value) ?? {};
  return {
    userId: asId(record.userId),
    username: asString(record.username),
    fullName: asString(record.fullName ?? record.username ?? 'Unknown user'),
    userStatus: asNullableString(record.userStatus),
    outletId: asId(record.outletId),
    outletCode: asNullableString(record.outletCode),
    outletName: asNullableString(record.outletName),
    roles: asStringArray(record.roles),
    permissions: asStringArray(record.permissions),
  };
}

function decodeAuthPermissionOverride(value: unknown): AuthPermissionOverrideView {
  const record = asRecord(value) ?? {};
  return {
    userId: asId(record.userId),
    username: asString(record.username),
    fullName: asString(record.fullName ?? record.username ?? 'Unknown user'),
    userStatus: asNullableString(record.userStatus),
    outletId: asId(record.outletId),
    outletCode: asNullableString(record.outletCode),
    outletName: asNullableString(record.outletName),
    permissionCode: asString(record.permissionCode),
    permissionName: asNullableString(record.permissionName),
    assignedAt: asIsoDateTime(record.assignedAt),
  };
}

function decodeBusinessScope(value: unknown): AuthBusinessScopeView {
  const record = asRecord(value) ?? {};
  return {
    scopeType: asString(record.scopeType),
    scopeId: asNullableString(record.scopeId),
    scopeCode: asNullableString(record.scopeCode),
    roles: asStringArray(record.roles),
    outletIds: asStringArray(record.outletIds),
  };
}

function decodePermissionCatalogItem(value: unknown): AuthPermissionCatalogItem {
  const record = asRecord(value) ?? {};
  return {
    code: asString(record.code),
    name: asNullableString(record.name),
    description: asNullableString(record.description),
    module: asNullableString(record.module),
    published: asBoolean(record.published),
    assignedRoleCount: Number(record.assignedRoleCount ?? 0),
    createdAt: asIsoDateTime(record.createdAt),
    updatedAt: asIsoDateTime(record.updatedAt),
  };
}

function decodeRoleCatalogItem(value: unknown): AuthRoleCatalogItem {
  const record = asRecord(value) ?? {};
  return {
    code: asString(record.code),
    name: asNullableString(record.name),
    description: asNullableString(record.description),
    published: asBoolean(record.published),
    assignedPermissionCount: Number(record.assignedPermissionCount ?? 0),
    createdAt: asIsoDateTime(record.createdAt),
    updatedAt: asIsoDateTime(record.updatedAt),
  };
}

function decodeBusinessRoleCatalogItem(value: unknown): AuthBusinessRoleCatalogItem {
  const record = asRecord(value) ?? {};
  return {
    code: asString(record.code),
    name: asNullableString(record.name),
    description: asNullableString(record.description),
    scopeType: asNullableString(record.scopeType),
    aliases: asStringArray(record.aliases),
  };
}

export const authApi = {
  login: async (username: string, password: string): Promise<AuthSession> =>
    decodeAuthSession(
      await apiRequest('/api/v1/auth/login', {
        method: 'POST',
        body: { username, password },
      }),
    ),
  me: async (token?: string | null): Promise<AuthSession> =>
    decodeAuthSession(await apiRequest('/api/v1/auth/me', { token: token ?? undefined })),
  refresh: async (token?: string | null): Promise<AuthSession> =>
    decodeAuthSession(await apiRequest('/api/v1/auth/refresh', { method: 'POST', token: token ?? undefined })),
  logout: async (token?: string | null): Promise<void> => {
    await apiRequest('/api/v1/auth/logout', { method: 'POST', token: token ?? undefined });
  },
  sessions: async (token: string): Promise<AuthSessionRow[]> =>
    decodeArray(await apiRequest('/api/v1/auth/sessions', { token }), decodeSessionRow),
  revokeSession: async (token: string, sessionId: string): Promise<void> => {
    await apiRequest(`/api/v1/auth/sessions/${sessionId}/revoke`, { method: 'POST', token });
  },
  users: async (token: string, query: AuthUsersQuery): Promise<PagedResponse<AuthUserListItem>> =>
    decodePaged(await apiRequest('/api/v1/auth/users', { token, query }), decodeAuthUserListItem),
  scopes: async (token: string, query: AuthScopesQuery): Promise<PagedResponse<AuthScopeView>> =>
    decodePaged(await apiRequest('/api/v1/auth/scopes', { token, query }), decodeAuthScope),
  overrides: async (token: string, query: AuthOverridesQuery): Promise<PagedResponse<AuthPermissionOverrideView>> =>
    decodePaged(await apiRequest('/api/v1/auth/overrides', { token, query }), decodeAuthPermissionOverride),
  permissions: async (token: string, query: AuthPermissionsQuery): Promise<PagedResponse<AuthPermissionCatalogItem>> =>
    decodePaged(await apiRequest('/api/v1/auth/permissions', { token, query }), decodePermissionCatalogItem),
  roles: async (token: string, query: AuthRolesQuery): Promise<PagedResponse<AuthRoleCatalogItem>> =>
    decodePaged(await apiRequest('/api/v1/auth/roles', { token, query }), decodeRoleCatalogItem),
  businessRoles: async (token: string): Promise<AuthBusinessRoleCatalogItem[]> =>
    decodeArray(await apiRequest('/api/v1/auth/business-roles', { token }), decodeBusinessRoleCatalogItem),
  createUser: async (token: string, payload: CreateAuthUserPayload): Promise<unknown> =>
    apiRequest('/api/v1/auth/users', { method: 'POST', token, body: payload }),
  replaceRolePermissions: async (token: string, roleCode: string, permissionCodes: string[]): Promise<unknown> =>
    apiRequest(`/api/v1/auth/roles/${roleCode}/permissions`, {
      method: 'PUT',
      token,
      body: { permissionCodes },
    }),
  assignRole: async (token: string, userId: string, outletId: string, roleCode: string): Promise<unknown> =>
    apiRequest(`/api/v1/auth/users/${userId}/roles`, {
      method: 'POST',
      token,
      body: { outletId: outletId, roleCode },
    }),
  revokeRole: async (token: string, userId: string, outletId: string, roleCode: string): Promise<unknown> =>
    apiRequest(`/api/v1/auth/users/${userId}/roles/revoke`, {
      method: 'POST',
      token,
      body: { outletId: outletId, roleCode },
    }),
  grantPermission: async (token: string, userId: string, outletId: string, permissionCode: string): Promise<unknown> =>
    apiRequest(`/api/v1/auth/users/${userId}/permissions`, {
      method: 'POST',
      token,
      body: { outletId: outletId, permissionCode },
    }),
  revokePermission: async (token: string, userId: string, outletId: string, permissionCode: string): Promise<unknown> =>
    apiRequest(`/api/v1/auth/users/${userId}/permissions/revoke`, {
      method: 'POST',
      token,
      body: { outletId: outletId, permissionCode },
    }),
  updateUserStatus: async (token: string, userId: string, status: string): Promise<unknown> =>
    apiRequest(`/api/v1/auth/users/${userId}/status`, {
      method: 'PUT',
      token,
      body: { status },
    }),
};
