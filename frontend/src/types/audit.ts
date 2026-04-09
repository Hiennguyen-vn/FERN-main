// Audit and security event types

export type AuditAction = 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'cancel' | 'login' | 'logout' | 'export';
export type AuditResult = 'success' | 'failure' | 'denied';
export type AuditModule = 'pos' | 'inventory' | 'procurement' | 'catalog' | 'iam' | 'auth' | 'system';

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  module: AuditModule;
  action: AuditAction;
  entity: string;
  entityId: string;
  result: AuditResult;
  scopeLevel: string;
  scopeName: string;
  ipAddress: string;
  correlationId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
}

export type SecurityEventSeverity = 'info' | 'warning' | 'critical';

export interface SecurityEvent {
  id: string;
  timestamp: string;
  severity: SecurityEventSeverity;
  type: string;
  actor: string;
  ipAddress: string;
  description: string;
  resolved: boolean;
  correlationId: string;
}

export interface RequestTrace {
  id: string;
  correlationId: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  actor: string;
  service: string;
  parentSpanId?: string;
}
