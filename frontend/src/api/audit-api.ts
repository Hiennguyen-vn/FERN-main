import { apiRequest, type PagedResponse } from '@/api/client';
import { decodePaged } from '@/api/decoders';
import { asId, asNullableNumber, asNullableString, asRecord } from '@/api/records';

export interface AuditLogView {
  id: string;
  module?: string | null;
  action?: string | null;
  entityName?: string | null;
  entityId?: string | null;
  actorUserId?: string | null;
  createdAt?: string | null;
  newData?: unknown;
  oldData?: unknown;
  [key: string]: unknown;
}

export interface AuditSecurityEvent {
  id: string;
  createdAt?: string | null;
  severity?: string | null;
  eventType?: string | null;
  actorUserId?: string | null;
  action?: string | null;
  entityName?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  description?: string | null;
}

export interface AuditTrace {
  id: string;
  createdAt?: string | null;
  correlationId?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  actorUserId?: string | null;
  action?: string | null;
  entityName?: string | null;
  entityId?: string | null;
  service?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogsQuery {
  module?: string;
  action?: string;
  actorUserId?: string;
  entityName?: string;
  entityId?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AuditSecurityEventsQuery {
  severity?: string;
  actorUserId?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AuditTracesQuery {
  action?: string;
  entityName?: string;
  actorUserId?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function decodeAuditLog(value: unknown): AuditLogView {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    id: asId(record.id),
    module: asNullableString(record.module),
    action: asNullableString(record.action),
    entityName: asNullableString(record.entityName),
    entityId: asNullableString(record.entityId),
    actorUserId: record.actorUserId === null || record.actorUserId === undefined ? null : asId(record.actorUserId),
    createdAt: asNullableString(record.createdAt),
    newData: record.newData,
    oldData: record.oldData,
  };
}

function decodeAuditSecurityEvent(value: unknown): AuditSecurityEvent {
  const record = asRecord(value) ?? {};
  return {
    id: asId(record.id),
    createdAt: asNullableString(record.createdAt),
    severity: asNullableString(record.severity),
    eventType: asNullableString(record.eventType),
    actorUserId: record.actorUserId === null || record.actorUserId === undefined ? null : asId(record.actorUserId),
    action: asNullableString(record.action),
    entityName: asNullableString(record.entityName),
    entityId: asNullableString(record.entityId),
    ipAddress: asNullableString(record.ipAddress),
    userAgent: asNullableString(record.userAgent),
    description: asNullableString(record.description),
  };
}

function decodeAuditTrace(value: unknown): AuditTrace {
  const record = asRecord(value) ?? {};
  return {
    id: asId(record.id),
    createdAt: asNullableString(record.createdAt),
    correlationId: asNullableString(record.correlationId),
    method: asNullableString(record.method),
    path: asNullableString(record.path),
    statusCode: asNullableNumber(record.statusCode),
    durationMs: asNullableNumber(record.durationMs),
    actorUserId: record.actorUserId === null || record.actorUserId === undefined ? null : asId(record.actorUserId),
    action: asNullableString(record.action),
    entityName: asNullableString(record.entityName),
    entityId: asNullableString(record.entityId),
    service: asNullableString(record.service),
    ipAddress: asNullableString(record.ipAddress),
    userAgent: asNullableString(record.userAgent),
  };
}

export const auditApi = {
  logs: async (token: string, query: AuditLogsQuery): Promise<PagedResponse<AuditLogView>> =>
    decodePaged(await apiRequest('/api/v1/audit/logs', { token, query }), decodeAuditLog),
  detail: async (token: string, auditLogId: string): Promise<AuditLogView> =>
    decodeAuditLog(await apiRequest(`/api/v1/audit/logs/${auditLogId}`, { token })),
  securityEvents: async (token: string, query: AuditSecurityEventsQuery): Promise<PagedResponse<AuditSecurityEvent>> =>
    decodePaged(await apiRequest('/api/v1/audit/security-events', { token, query }), decodeAuditSecurityEvent),
  traces: async (token: string, query: AuditTracesQuery): Promise<PagedResponse<AuditTrace>> =>
    decodePaged(await apiRequest('/api/v1/audit/traces', { token, query }), decodeAuditTrace),
};

