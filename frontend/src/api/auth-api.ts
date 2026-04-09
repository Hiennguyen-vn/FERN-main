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
  issuedAt?: string;
  expiresAt?: string;
}

export interface AuthSessionRow {
  sessionId: string;
  state?: string | null;
  current?: boolean;
  issuedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
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
    revokedAt: asIsoDateTime(record.revokedAt),
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
  createUser: async (token: string, payload: CreateAuthUserPayload): Promise<unknown> =>
    apiRequest('/api/v1/auth/users', { method: 'POST', token, body: payload }),
  replaceRolePermissions: async (token: string, roleCode: string, permissionCodes: string[]): Promise<unknown> =>
    apiRequest(`/api/v1/auth/roles/${roleCode}/permissions`, {
      method: 'PUT',
      token,
      body: { permissionCodes },
    }),
};
