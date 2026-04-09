import { useState } from 'react';
import {
  Shield, Key, Globe, ShieldAlert, Eye, AlertTriangle,
  ArrowRight, CheckCircle, XCircle, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BranchBlockedBanner, StatusBadge, BootstrapGapChip } from './IAMDashboard';
import {
  mockIAMUsers, mockIAMRoles, mockIAMPermissions, mockIAMScopes,
  mockOverrides, mockEffectiveAccess,
} from '@/data/mock-iam';

/* ═══════════════ ROLE MANAGEMENT ═══════════════ */
export function RoleManagement() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const permissionsByModule = mockIAMPermissions.reduce((acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  }, {} as Record<string, typeof mockIAMPermissions>);

  return (
    <div className="space-y-5">
      <BranchBlockedBanner />

      <div className="grid grid-cols-3 gap-4">
        {/* Roles List */}
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Roles ({mockIAMRoles.length})</span>
          </div>
          <div className="p-3 space-y-1">
            {mockIAMRoles.map(r => (
              <button
                key={r.id}
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className={cn('w-full text-left p-2.5 rounded-lg border transition-colors',
                  expanded === r.id ? 'bg-primary/5 border-primary/20' : 'hover:bg-muted/20 border-transparent'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{r.name}</span>
                  {r.builtIn && <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">built-in</span>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{r.permissionCount} perms · {r.userCount} users</p>
              </button>
            ))}
          </div>
        </div>

        {/* Permission Matrix */}
        <div className="col-span-2 surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Permission Matrix by Module</span>
          </div>
          <div className="p-4 space-y-4">
            {Object.entries(permissionsByModule).map(([mod, perms]) => (
              <div key={mod}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{mod}</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <tbody>
                      {perms.map(p => (
                        <tr key={p.code} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-xs text-foreground w-56">{p.code}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.description}</td>
                          <td className="px-4 py-2.5 text-right">
                            {!p.published ? <BootstrapGapChip /> : (
                              <span className="text-[10px] text-muted-foreground">{p.assignedRoleCount} roles</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ PERMISSION MANAGEMENT ═══════════════ */
export function PermissionManagement() {
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const modules = [...new Set(mockIAMPermissions.map(p => p.module))];
  const filtered = moduleFilter === 'all' ? mockIAMPermissions : mockIAMPermissions.filter(p => p.module === moduleFilter);
  const unpublished = mockIAMPermissions.filter(p => !p.published);

  return (
    <div className="space-y-5">
      <BranchBlockedBanner />

      {unpublished.length > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-destructive/5 border border-destructive/15">
          <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-foreground">Bootstrap Gap — {unpublished.length} Unpublished Permissions</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {unpublished.map(p => p.code).join(', ')} are defined in PermissionCodes but are not yet available from the IAM backend.
              Roles cannot reference these codes until the environment finishes synchronizing permission metadata.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Module</span>
        {['all', ...modules].map(m => (
          <button key={m} onClick={() => setModuleFilter(m)}
            className={cn('text-[11px] px-2.5 py-1.5 rounded-md border transition-colors capitalize',
              moduleFilter === m ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
            )}>
            {m}
          </button>
        ))}
      </div>

      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Permission Code', 'Module', 'Description', 'Status', 'Roles'].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Roles' ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.code} className={cn('border-b last:border-0 hover:bg-muted/20 transition-colors', !p.published && 'bg-warning/[0.02]')}>
                <td className="px-4 py-2.5 font-mono text-xs text-foreground">{p.code}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{p.module}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.description}</td>
                <td className="px-4 py-2.5">
                  {p.published ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-success"><CheckCircle className="h-2.5 w-2.5" />Published</span>
                  ) : (
                    <BootstrapGapChip />
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{p.assignedRoleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════ SCOPE ASSIGNMENT ═══════════════ */
export function ScopeAssignment() {
  return (
    <div className="space-y-5">
      <BranchBlockedBanner />

      <div className="grid grid-cols-2 gap-4">
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Scope Assignments</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['User', 'Level', 'Scope', 'Since'].map(h => (
                  <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockIAMScopes.map(s => (
                <tr key={`${s.userId}-${s.scopeId}`} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{s.userName}</td>
                  <td className="px-4 py-2.5"><span className={`scope-chip scope-chip-${s.scopeLevel} !text-[10px] !px-1.5 !py-0`}>{s.scopeLevel}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{s.scopeName}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{s.assignedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Scope Hierarchy</span>
          </div>
          <div className="p-4">
            <div className="bg-muted/20 rounded-lg p-4 space-y-3">
              {[
                { level: 'system', label: 'System', desc: 'Full access across all regions and outlets', count: mockIAMScopes.filter(s => s.scopeLevel === 'system').length },
                { level: 'region', label: 'Region', desc: 'Access to a specific region and its outlets', count: mockIAMScopes.filter(s => s.scopeLevel === 'region').length },
                { level: 'outlet', label: 'Outlet', desc: 'Access limited to a single outlet', count: mockIAMScopes.filter(s => s.scopeLevel === 'outlet').length },
              ].map((s, i) => (
                <div key={s.level} className="flex items-center gap-3">
                  {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground -mt-4 ml-5" />}
                  <div className="flex-1 p-3 rounded-lg border bg-card">
                    <div className="flex items-center justify-between">
                      <span className={`scope-chip scope-chip-${s.level} !text-[10px]`}>{s.label}</span>
                      <span className="text-[10px] text-muted-foreground">{s.count} users</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ PERMISSION OVERRIDES ═══════════════ */
export function OverrideManagement() {
  return (
    <div className="space-y-5">
      <BranchBlockedBanner />

      <div className="flex items-start gap-2.5 p-3 rounded-md bg-info/5 border border-info/10">
        <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-foreground">Exception-Based Access</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Overrides grant or deny specific permissions outside the normal role-based model. 
            They should be temporary and well-documented. Each override carries audit risk.
          </p>
        </div>
      </div>

      <div className="surface-elevated overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Active Overrides ({mockOverrides.length})</span>
          <Button size="sm" className="h-8 text-xs" disabled>Create Override</Button>
        </div>
        <div className="p-4 space-y-3">
          {mockOverrides.map(o => (
            <div key={o.id} className={cn('p-4 rounded-lg border', o.effect === 'deny' ? 'border-destructive/20 bg-destructive/[0.02]' : 'border-warning/20 bg-warning/[0.02]')}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{o.userName}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <code className="text-[11px] font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">{o.permission}</code>
                </div>
                <Badge variant={o.effect === 'grant' ? 'default' : 'destructive'} className="text-[10px] uppercase">{o.effect}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{o.reason}</p>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                <span>By {o.createdBy}</span>
                <span>{o.createdAt}</span>
                {o.expiresAt ? <span className="text-warning">Expires {o.expiresAt}</span> : <span className="text-destructive">No expiration</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ EFFECTIVE ACCESS INSPECTOR ═══════════════ */
export function EffectiveAccessInspector() {
  const [selectedUser, setSelectedUser] = useState<string>('usr-003');
  const user = mockIAMUsers.find(u => u.id === selectedUser)!;

  return (
    <div className="space-y-5">
      <BranchBlockedBanner />

      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-foreground">Inspect user:</span>
        <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)}
          className="text-xs rounded-md border bg-background text-foreground px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring h-8">
          {mockIAMUsers.map(u => (
            <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>
          ))}
        </select>
      </div>

      {/* User summary KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Roles', value: user.roles.length, sub: user.roles.map(r => <p key={r} className="text-[10px] font-mono text-muted-foreground">{r}</p>) },
          { label: 'Scope', value: user.scopeSummary },
          { label: 'Overrides', value: mockOverrides.filter(o => o.userId === user.id).length },
          { label: 'Status', value: null, badge: <StatusBadge status={user.status} /> },
        ].map(k => (
          <div key={k.label} className="surface-elevated p-4">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</span>
            {k.badge ? <div className="mt-2">{k.badge}</div> : <p className="text-xl font-semibold text-foreground mt-1">{k.value}</p>}
            {k.sub && <div className="mt-1 space-y-0.5">{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Effective permissions table */}
      <div className="surface-elevated overflow-x-auto">
        <div className="px-4 py-3 border-b">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Effective Permissions</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Permission', 'Module', 'Source', 'Via', 'Effect', 'Status'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockEffectiveAccess.map(e => (
              <tr key={e.permission} className={cn('border-b last:border-0 hover:bg-muted/20 transition-colors', !e.published && 'bg-warning/[0.02]')}>
                <td className="px-4 py-2.5 font-mono text-xs text-foreground">{e.permission}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{e.module}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium',
                    e.source === 'role' ? 'bg-primary/10 text-primary' : e.source === 'override' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'
                  )}>{e.source}</span>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.sourceName}</td>
                <td className="px-4 py-2.5">
                  {e.effect === 'allow' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-success"><CheckCircle className="h-2.5 w-2.5" />Allow</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-destructive"><XCircle className="h-2.5 w-2.5" />Deny</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {e.published ? <span className="text-[10px] text-success">Published</span> : <BootstrapGapChip />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-md bg-warning/5 border border-warning/10">
        <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-foreground">Bootstrap Gap Detected</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Permissions marked "Not Published" (<code className="text-[10px] bg-muted px-1 rounded">pos.table.*</code>) exist in PermissionCodes but have not been bootstrapped into the IAM database.
            No role can reference or assign these codes until the IAM backend finishes publishing the latest permission set.
          </p>
        </div>
      </div>
    </div>
  );
}
