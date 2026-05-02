import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  FileText, Shield, Activity, Loader2, RefreshCw, Search,
} from 'lucide-react';
import { reportError } from '@/lib/report-error';
import { cn } from '@/lib/utils';
import {
  auditApi,
  type AuditLogView,
  type AuditSecurityEvent,
  type AuditTrace,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

type AuditTab = 'events' | 'security' | 'traces';

const TABS: { key: AuditTab; label: string; icon: React.ElementType }[] = [
  { key: 'events', label: 'Audit Explorer', icon: FileText },
  { key: 'security', label: 'Security Events', icon: Shield },
  { key: 'traces', label: 'Request Traces', icon: Activity },
];

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function shortId(value?: string | null) {
  const s = String(value ?? '').trim();
  if (!s || s === '—') return '—';
  return s.length > 10 ? `…${s.slice(-8)}` : s;
}

function readDataField(data: unknown, keys: string[]): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function moduleFromEntity(entityName?: string | null): string | null {
  const entity = String(entityName ?? '').toLowerCase();
  if (['purchase_order', 'goods_receipt', 'supplier_invoice', 'payment'].includes(entity)) return 'procurement';
  if (['stock_balance', 'stock_count_session', 'waste'].includes(entity)) return 'inventory';
  if (['sale_record', 'pos_session'].includes(entity)) return 'sales';
  if (['expense_record', 'fiscal_period'].includes(entity)) return 'finance';
  if (['payroll', 'payroll_run'].includes(entity)) return 'payroll';
  if (['contract', 'attendance'].includes(entity)) return 'hr';
  if (['shift', 'work_shift'].includes(entity)) return 'workforce';
  if (['app_user', 'role', 'user_role'].includes(entity)) return 'auth';
  if (['outlet', 'region', 'exchange_rate'].includes(entity)) return 'org';
  return null;
}

function getLogModule(log: AuditLogView): string | null {
  const explicit = String(log.module ?? '').trim();
  if (explicit) return explicit;
  const reasonPrefix = String(log.reason ?? '').split('.')[0]?.trim();
  if (reasonPrefix && reasonPrefix !== String(log.reason ?? '').trim()) return reasonPrefix;
  return moduleFromEntity(log.entityName);
}

function getLogActor(log: AuditLogView): string | null {
  const explicit = String(log.actorUserId ?? '').trim();
  if (explicit) return explicit;
  return readDataField(log.newData, ['actorUserId', 'approvedByUserId', 'createdByUserId', 'userId', 'managerId'])
    ?? readDataField(log.oldData, ['actorUserId', 'approvedByUserId', 'createdByUserId', 'userId', 'managerId']);
}

function getLogCorrelation(log: AuditLogView): string {
  const explicit = String(log.correlationId ?? '').trim();
  if (explicit) return explicit;
  const fromData = readDataField(log.newData, ['correlationId', 'traceId', 'requestId', 'eventId', 'sourceEventId'])
    ?? readDataField(log.oldData, ['correlationId', 'traceId', 'requestId', 'eventId', 'sourceEventId']);
  return fromData || `audit:${log.id}`;
}

const ACTION_LABELS: Record<string, string> = {
  insert: 'Create',
  update: 'Update',
  delete: 'Delete',
  approve: 'Approve',
  reject: 'Reject',
  cancel: 'Cancel',
  close: 'Close',
  reopen: 'Reopen',
  post: 'Post',
  reverse: 'Reverse',
  mark_paid: 'Mark Paid',
  payroll_approve: 'Payroll Approve',
  payroll_mark_paid: 'Payroll Mark Paid',
  stock_count_post: 'Stock Count Post',
  period_close: 'Period Close',
  manager_override: 'Manager Override',
  update_stock_balance: 'Update Stock Balance',
  insert_outlet: 'Create Outlet',
  update_event: 'Update Event',
};

function formatActionLabel(action?: string | null) {
  const raw = String(action ?? '').trim();
  if (!raw) return '—';
  return ACTION_LABELS[raw.toLowerCase()] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const DOMAIN_MODULES = [
  { value: '', label: 'All modules' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'sales', label: 'Sales' },
  { value: 'finance', label: 'Finance' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'hr', label: 'HR' },
  { value: 'workforce', label: 'Workforce' },
  { value: 'auth', label: 'Auth' },
  { value: 'audit', label: 'Audit' },
];

export function AuditModule() {
  const { token } = useShellRuntime();
  const [activeTab, setActiveTab] = useState<AuditTab>('events');

  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState('');
  const [logs, setLogs] = useState<AuditLogView[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [selected, setSelected] = useState<AuditLogView | null>(null);

  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [securityEvents, setSecurityEvents] = useState<AuditSecurityEvent[]>([]);
  const [securityTotal, setSecurityTotal] = useState(0);
  const [securityHasMore, setSecurityHasMore] = useState(false);

  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');
  const [traces, setTraces] = useState<AuditTrace[]>([]);
  const [traceTotal, setTraceTotal] = useState(0);
  const [traceHasMore, setTraceHasMore] = useState(false);

  const logsQuery = useListQueryState({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
  });
  const securityQuery = useListQueryState({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
  });
  const traceQuery = useListQueryState({
    initialLimit: 20,
    initialSortBy: 'createdAt',
    initialSortDir: 'desc',
  });

  const loadLogs = useCallback(async () => {
    if (!token) {
      setLogsLoading(false);
      setLogs([]);
      setLogsTotal(0);
      setLogsHasMore(false);
      return;
    }
    setLogsLoading(true);
    setLogsError('');
    try {
      const page = await auditApi.logs(token, logsQuery.query);
      setLogs(page.items || []);
      setLogsTotal(page.total || page.totalCount || 0);
      setLogsHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      reportError(error, 'audit.logs.load');
      setLogs([]);
      setLogsTotal(0);
      setLogsHasMore(false);
      setLogsError(getErrorMessage(error, 'Unable to load audit logs'));
    } finally {
      setLogsLoading(false);
    }
  }, [logsQuery.query, token]);

  const loadSecurityEvents = useCallback(async () => {
    if (!token) return;
    setSecurityLoading(true);
    setSecurityError('');
    try {
      const page = await auditApi.securityEvents(token, securityQuery.query);
      setSecurityEvents(page.items || []);
      setSecurityTotal(page.total || page.totalCount || 0);
      setSecurityHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      reportError(error, 'audit.security-events.load');
      setSecurityEvents([]);
      setSecurityTotal(0);
      setSecurityHasMore(false);
      setSecurityError(getErrorMessage(error, 'Unable to load security events'));
    } finally {
      setSecurityLoading(false);
    }
  }, [securityQuery.query, token]);

  const loadTraces = useCallback(async () => {
    if (!token) return;
    setTraceLoading(true);
    setTraceError('');
    try {
      const page = await auditApi.traces(token, traceQuery.query);
      setTraces(page.items || []);
      setTraceTotal(page.total || page.totalCount || 0);
      setTraceHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      reportError(error, 'audit.traces.load');
      setTraces([]);
      setTraceTotal(0);
      setTraceHasMore(false);
      setTraceError(getErrorMessage(error, 'Unable to load request traces'));
    } finally {
      setTraceLoading(false);
    }
  }, [token, traceQuery.query]);

  useEffect(() => {
    if (activeTab !== 'events') return;
    void loadLogs();
  }, [activeTab, loadLogs]);

  useEffect(() => {
    if (activeTab !== 'security') return;
    void loadSecurityEvents();
  }, [activeTab, loadSecurityEvents]);

  useEffect(() => {
    if (activeTab !== 'traces') return;
    void loadTraces();
  }, [activeTab, loadTraces]);

  const openDetail = async (id: string) => {
    if (!token) return;
    try {
      const detail = await auditApi.detail(token, id);
      setSelected(detail);
    } catch {
      setSelected(null);
    }
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Audit" />;
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'events' && (
          <div className="space-y-4">
            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Audit Logs ({logsTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search audit logs"
                      value={logsQuery.searchInput}
                      onChange={(event) => logsQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={String(logsQuery.filters.module || '')}
                    onChange={(e) => logsQuery.setFilter('module', e.target.value || undefined)}
                  >
                    {DOMAIN_MODULES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={String(logsQuery.filters.entityName || '')}
                    onChange={(e) => logsQuery.setFilter('entityName', e.target.value || undefined)}
                  >
                    <option value="">All entities</option>
                    <option value="purchase_order">Purchase Order</option>
                    <option value="goods_receipt">Goods Receipt</option>
                    <option value="invoice">Invoice</option>
                    <option value="payment">Payment</option>
                    <option value="stock_balance">Stock Balance</option>
                    <option value="stock_count_session">Stock Count</option>
                    <option value="waste">Waste</option>
                    <option value="payroll_run">Payroll Run</option>
                    <option value="contract">Contract</option>
                    <option value="shift">Shift</option>
                    <option value="outlet">Outlet</option>
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${logsQuery.sortBy || 'createdAt'}:${logsQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      logsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="createdAt:desc">Latest First</option>
                    <option value="createdAt:asc">Oldest First</option>
                    <option value="action:asc">Action A-Z</option>
                    <option value="action:desc">Action Z-A</option>
                  </select>
                  <button
                    onClick={() => void loadLogs()}
                    disabled={logsLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', logsLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              {logsError ? <p className="text-xs text-destructive">{logsError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-[11px] px-4 py-2.5">Time</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Action</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Entity</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Actor</th>
                      <th className="text-left text-[11px] px-4 py-2.5">Correlation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsLoading && logs.length === 0 ? (
                      <ListTableSkeleton columns={5} rows={7} />
                    ) : logs.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No audit logs found</td></tr>
                    ) : logs.map((log) => {
                      const moduleLabel = getLogModule(log);
                      const actor = getLogActor(log);
                      const correlation = getLogCorrelation(log);
                      return (
                        <tr key={String(log.id)} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => void openDetail(String(log.id))}>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                          <td className="px-4 py-2.5 text-xs">
                            <div className="flex items-center gap-1.5">
                              {moduleLabel ? (
                                <span className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{moduleLabel}</span>
                              ) : null}
                              <span>{formatActionLabel(log.action)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            <span>{String(log.entityName || '—').replace(/_/g, ' ')}</span>
                            <span className="ml-1 font-mono text-muted-foreground" title={String(log.entityId || '')}>{shortId(log.entityId)}</span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono" title={actor || ''}>{actor ? shortId(actor) : 'system'}</td>
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground" title={correlation}>{shortId(correlation)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ListPaginationControls
                total={logsTotal}
                limit={logsQuery.limit}
                offset={logsQuery.offset}
                hasMore={logsHasMore}
                disabled={logsLoading}
                onPageChange={logsQuery.setPage}
                onLimitChange={logsQuery.setPageSize}
              />
            </div>

            {selected ? (
              <div className="surface-elevated p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Selected Log</p>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
                    }}
                    className="text-[11px] underline text-primary hover:text-primary/80"
                  >
                    Copy JSON
                  </button>
                </div>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-xs">
                  {[
                    ['ID', selected.id],
                    ['Module', selected.module],
                    ['Entity', `${selected.entityName ?? '—'} #${selected.entityId ?? '—'}`],
                    ['Action', selected.action],
                    ['Actor', selected.actorUserId ?? '—'],
                    ['Created', selected.createdAt],
                    ['Reason', selected.reason ?? '—'],
                    ['Correlation', selected.correlationId ?? '—'],
                  ].map(([k, v]) => (
                    <Fragment key={k as string}>
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-mono break-all">{String(v ?? '—')}</dd>
                    </Fragment>
                  ))}
                </dl>
                {(selected.oldData || selected.newData) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Old</p>
                      <pre className="text-[11px] bg-muted/40 rounded p-2 whitespace-pre-wrap break-words max-h-60 overflow-auto">
                        {selected.oldData ? JSON.stringify(selected.oldData, null, 2) : '—'}
                      </pre>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">New</p>
                      <pre className="text-[11px] bg-muted/40 rounded p-2 whitespace-pre-wrap break-words max-h-60 overflow-auto">
                        {selected.newData ? JSON.stringify(selected.newData, null, 2) : '—'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-4">
            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Security Events ({securityTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search security events"
                      value={securityQuery.searchInput}
                      onChange={(event) => securityQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${securityQuery.sortBy || 'createdAt'}:${securityQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      securityQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="createdAt:desc">Latest First</option>
                    <option value="createdAt:asc">Oldest First</option>
                    <option value="severity:desc">Severity ↓</option>
                    <option value="severity:asc">Severity ↑</option>
                  </select>
                  <button
                    onClick={() => void loadSecurityEvents()}
                    disabled={securityLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', securityLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              {securityError ? <p className="text-xs text-destructive">{securityError}</p> : null}

              {securityLoading && securityEvents.length === 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {['Time', 'Severity', 'Event', 'Actor', 'Source'].map((header) => (
                          <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <ListTableSkeleton columns={5} rows={7} />
                    </tbody>
                  </table>
                </div>
              ) : securityEvents.length === 0 ? (
                <EmptyState
                  title="No security events found"
                  description="No security-focused audit events are available for the current scope."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {['Time', 'Severity', 'Event', 'Actor', 'Source'].map((header) => (
                          <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {securityEvents.map((event) => (
                        <tr key={event.id} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</td>
                          <td className="px-4 py-2.5 text-xs">{event.severity || '—'}</td>
                          <td className="px-4 py-2.5 text-xs">{event.eventType || event.action || '—'}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{event.actorUserId || '—'}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {event.entityName || '—'}{event.entityId ? ` · ${event.entityId}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <ListPaginationControls
                total={securityTotal}
                limit={securityQuery.limit}
                offset={securityQuery.offset}
                hasMore={securityHasMore}
                disabled={securityLoading}
                onPageChange={securityQuery.setPage}
                onLimitChange={securityQuery.setPageSize}
              />
            </div>
          </div>
        )}

        {activeTab === 'traces' && (
          <div className="space-y-4">
            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Request Traces ({traceTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search traces"
                      value={traceQuery.searchInput}
                      onChange={(event) => traceQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${traceQuery.sortBy || 'createdAt'}:${traceQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      traceQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="createdAt:desc">Latest First</option>
                    <option value="createdAt:asc">Oldest First</option>
                    <option value="durationMs:desc">Duration ↓</option>
                    <option value="durationMs:asc">Duration ↑</option>
                    <option value="statusCode:desc">Status ↓</option>
                    <option value="statusCode:asc">Status ↑</option>
                  </select>
                  <button
                    onClick={() => void loadTraces()}
                    disabled={traceLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', traceLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              {traceError ? <p className="text-xs text-destructive">{traceError}</p> : null}

              {traceLoading && traces.length === 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {['Time', 'Correlation', 'Request', 'Status', 'Duration', 'Service'].map((header) => (
                          <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <ListTableSkeleton columns={6} rows={7} />
                    </tbody>
                  </table>
                </div>
              ) : traces.length === 0 ? (
                <EmptyState
                  title="No request traces found"
                  description="No trace rows are available for the current scope and filters."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {['Time', 'Correlation', 'Request', 'Status', 'Duration', 'Service'].map((header) => (
                          <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {traces.map((trace) => (
                        <tr key={trace.id} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(trace.createdAt)}</td>
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{trace.correlationId || '—'}</td>
                          <td className="px-4 py-2.5 text-xs">{trace.method || '—'} {trace.path || ''}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{trace.statusCode ?? '—'}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{trace.durationMs == null ? '—' : `${trace.durationMs} ms`}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{trace.service || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <ListPaginationControls
                total={traceTotal}
                limit={traceQuery.limit}
                offset={traceQuery.offset}
                hasMore={traceHasMore}
                disabled={traceLoading}
                onPageChange={traceQuery.setPage}
                onLimitChange={traceQuery.setPageSize}
              />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
