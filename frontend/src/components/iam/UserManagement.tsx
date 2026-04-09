import { useState } from 'react';
import {
  Search, UserPlus, ChevronRight, Globe, Key, Shield, ShieldAlert,
  AlertTriangle, Lock, Unlock, UserX, Save, X, Mail, AtSign, Briefcase,
  ArrowRight, Info, CheckCircle, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BranchBlockedBanner, StatusBadge, BootstrapGapChip } from './IAMDashboard';
import {
  mockIAMUsers, mockIAMRoles, mockIAMScopes,
  mockOverrides, mockAuthFailures,
} from '@/data/mock-iam';
import type { IAMUser } from '@/types/iam';

/* ═══════════════ USER LIST ═══════════════ */
export function UserManagement({ onSelectUser, onCreateUser }: { onSelectUser: (u: IAMUser) => void; onCreateUser: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = mockIAMUsers.filter(u =>
    u.fullName.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <BranchBlockedBanner />

      <div className="flex items-start justify-between gap-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…" className="pl-9 h-8 text-sm" />
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onCreateUser}>
          <UserPlus className="h-3.5 w-3.5" /> Create User
        </Button>
      </div>

      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['User ID', 'Full Name', 'Username', 'Persona', 'Status', 'Scope', 'Last Login', ''].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">No matching users</td></tr>
            ) : (
              filtered.map(u => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors" onClick={() => onSelectUser(u)}>
                  <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{u.id}</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{u.fullName}</td>
                  <td className="px-4 py-2.5 text-sm font-mono text-foreground">{u.username}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.persona}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.scopeSummary}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-2.5"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════ USER DETAIL ═══════════════ */
export function UserDetail({ user, onBack, onEdit }: { user: IAMUser; onBack: () => void; onEdit: () => void }) {
  const userScopes = mockIAMScopes.filter(s => s.userId === user.id);
  const userOverrides = mockOverrides.filter(o => o.userId === user.id);
  const userFailures = mockAuthFailures.filter(f => f.username === user.username);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">← Back to Users</button>

      <BranchBlockedBanner />

      {/* Header card */}
      <div className="surface-elevated p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">{user.fullName.split(' ').map(n => n[0]).join('')}</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{user.fullName}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{user.persona} · <span className="font-mono">{user.username}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={user.status} />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onEdit}><Save className="h-3 w-3 mr-1" />Edit</Button>
            {user.status === 'locked' ? (
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled><Unlock className="h-3 w-3 mr-1" />Unlock</Button>
            ) : user.status === 'active' ? (
              <Button size="sm" variant="outline" className="h-8 text-xs text-destructive" disabled><UserX className="h-3 w-3 mr-1" />Suspend</Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Roles */}
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Assigned Roles</span>
          </div>
          <div className="p-4 space-y-1.5">
            {user.roles.map(r => {
              const role = mockIAMRoles.find(rl => rl.name === r);
              return (
                <div key={r} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/20">
                  <span className="text-xs font-mono text-foreground">{r}</span>
                  <span className="text-[10px] text-muted-foreground">{role?.permissionCount || 0} permissions</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scopes */}
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Scope Assignments</span>
          </div>
          <div className="p-4 space-y-1.5">
            {userScopes.map(s => (
              <div key={s.scopeId} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/20">
                <div className="flex items-center gap-2">
                  <Globe className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-foreground">{s.scopeName}</span>
                </div>
                <span className={`scope-chip scope-chip-${s.scopeLevel} !text-[10px] !px-1.5 !py-0`}>{s.scopeLevel}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overrides */}
      {userOverrides.length > 0 && (
        <div className="surface-elevated overflow-hidden border-warning/20">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-warning" />Permission Overrides
            </span>
          </div>
          <div className="p-4 space-y-2">
            {userOverrides.map(o => (
              <div key={o.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-muted/20">
                <div>
                  <code className="text-[11px] font-mono text-foreground">{o.permission}</code>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{o.reason}</p>
                </div>
                <Badge variant={o.effect === 'grant' ? 'default' : 'destructive'} className="text-[10px]">{o.effect}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Security Events */}
      {userFailures.length > 0 && (
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Security Events</span>
          </div>
          <div className="p-4 space-y-2">
            {userFailures.map(f => (
              <div key={f.id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/20">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-foreground">{f.reason}</p>
                  <p className="text-[10px] text-muted-foreground">{f.ip} · {new Date(f.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════ CREATE USER ═══════════════ */
export function CreateUserForm({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState({
    fullName: '', username: '', email: '', persona: '', initialPassword: '',
    scopeLevel: 'outlet' as 'system' | 'region' | 'outlet',
    scopeId: '',
    roles: [] as string[],
    sendWelcomeEmail: true,
  });

  const update = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [field]: value }));
  const toggleRole = (role: string) => setForm(prev => ({
    ...prev,
    roles: prev.roles.includes(role) ? prev.roles.filter(r => r !== role) : [...prev.roles, role],
  }));

  const scopeOptions: Record<string, { id: string; name: string }[]> = {
    system: [{ id: 'system', name: 'System-wide' }],
    region: [
      { id: 'region-central', name: 'Central Region' },
      { id: 'region-north', name: 'North Region' },
      { id: 'region-south', name: 'South Region' },
    ],
    outlet: [
      { id: 'outlet-001', name: 'Downtown Flagship' },
      { id: 'outlet-002', name: 'Riverside Branch' },
      { id: 'outlet-003', name: 'Mall Kiosk A' },
      { id: 'outlet-004', name: 'Uptown Express' },
      { id: 'outlet-005', name: 'Station Café' },
      { id: 'outlet-006', name: 'Harbor View' },
    ],
  };

  const personaOptions = ['System Administrator', 'Regional Manager', 'Outlet Manager', 'POS Cashier', 'Finance Lead', 'Procurement Officer', 'HR Reviewer', 'Audit Viewer'];
  const isValid = form.fullName && form.username && form.email && form.persona && form.initialPassword && form.scopeId && form.roles.length > 0;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">← Back to Users</button>

      <BranchBlockedBanner />

      {/* Header */}
      <div className="surface-elevated p-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <UserPlus className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Create New User</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Provision a new user account with role and scope assignment</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Identity */}
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" />Identity</span>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Full Name *</label>
              <Input value={form.fullName} onChange={e => update('fullName', e.target.value)} placeholder="e.g. Jane Smith" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Username *</label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={form.username} onChange={e => update('username', e.target.value)} placeholder="jane.smith" className="pl-9 h-8 text-sm font-mono" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Email *</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="jane.smith@company.com" className="pl-9 h-8 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Persona *</label>
              <select value={form.persona} onChange={e => update('persona', e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring h-8">
                <option value="">Select persona...</option>
                {personaOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Initial Password *</label>
              <Input type="password" value={form.initialPassword} onChange={e => update('initialPassword', e.target.value)} placeholder="••••••••" className="h-8 text-sm font-mono" />
              <p className="text-[10px] text-muted-foreground mt-1">Minimum 12 characters. User will be prompted to change on first login.</p>
            </div>
          </div>
        </div>

        {/* Scope + Roles */}
        <div className="space-y-4">
          <div className="surface-elevated overflow-hidden">
            <div className="px-4 py-3 border-b">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />Scope Assignment</span>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Scope Level *</label>
                <div className="flex gap-1.5">
                  {(['system', 'region', 'outlet'] as const).map(level => (
                    <button key={level} onClick={() => { update('scopeLevel', level); update('scopeId', ''); }}
                      className={cn('text-[11px] px-2.5 py-1.5 rounded-md border transition-colors capitalize',
                        form.scopeLevel === level ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
                      )}>
                      {level}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  {form.scopeLevel === 'system' ? 'Scope' : form.scopeLevel === 'region' ? 'Region' : 'Outlet'} *
                </label>
                <select value={form.scopeId} onChange={e => update('scopeId', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring h-8">
                  <option value="">Select...</option>
                  {scopeOptions[form.scopeLevel].map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="surface-elevated overflow-hidden">
            <div className="px-4 py-3 border-b">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Key className="h-3.5 w-3.5" />Role Assignment *</span>
            </div>
            <div className="p-4 space-y-1">
              {mockIAMRoles.map(r => (
                <label key={r.id} className={cn('flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors',
                  form.roles.includes(r.name) ? 'bg-primary/5 border-primary/20' : 'hover:bg-muted/20 border-transparent'
                )}>
                  <input type="checkbox" checked={form.roles.includes(r.name)} onChange={() => toggleRole(r.name)}
                    className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground font-mono">{r.name}</p>
                    <p className="text-[10px] text-muted-foreground">{r.description}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{r.permissionCount} perms</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="surface-elevated p-4">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.sendWelcomeEmail} onChange={e => update('sendWelcomeEmail', e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary" />
            <div>
              <p className="text-xs font-medium text-foreground">Send welcome email</p>
              <p className="text-[10px] text-muted-foreground">User will receive credentials and a link to set up their account</p>
            </div>
          </label>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onBack}><X className="h-3 w-3 mr-1" /> Cancel</Button>
            <Button size="sm" className="h-8 text-xs" disabled={!isValid}><Save className="h-3 w-3 mr-1" /> Create User</Button>
          </div>
        </div>
      </div>

      {/* Preview */}
      {isValid && (
        <div className="surface-elevated p-4 border-primary/20 bg-primary/[0.02]">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Account Preview</p>
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div><p className="text-muted-foreground">Name</p><p className="font-medium text-foreground">{form.fullName}</p></div>
            <div><p className="text-muted-foreground">Username</p><p className="font-mono text-foreground">{form.username}</p></div>
            <div><p className="text-muted-foreground">Roles</p><p className="font-mono text-foreground">{form.roles.join(', ')}</p></div>
            <div><p className="text-muted-foreground">Scope</p><p className="text-foreground">{scopeOptions[form.scopeLevel].find(o => o.id === form.scopeId)?.name || '—'}</p></div>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2.5 p-3 rounded-md bg-info/5 border border-info/10">
        <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-info leading-relaxed">
          User creation requires the IAM service to be available. While that dependency is unavailable, this form captures the target-state UX.
          The account will be provisioned via <code className="text-[10px] bg-muted px-1 rounded">POST /api/iam/users</code> once the IAM backend is ready.
        </p>
      </div>
    </div>
  );
}

/* ═══════════════ EDIT USER ═══════════════ */
export function EditUserForm({ user, onBack }: { user: IAMUser; onBack: () => void }) {
  const userScope = mockIAMScopes.find(s => s.userId === user.id);

  const [form, setForm] = useState({
    persona: user.persona,
    scopeLevel: (userScope?.scopeLevel || 'outlet') as 'system' | 'region' | 'outlet',
    scopeId: userScope?.scopeId || '',
    roles: [...user.roles],
  });

  const update = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [field]: value }));
  const toggleRole = (role: string) => setForm(prev => ({
    ...prev,
    roles: prev.roles.includes(role) ? prev.roles.filter(r => r !== role) : [...prev.roles, role],
  }));

  const scopeOptions: Record<string, { id: string; name: string }[]> = {
    system: [{ id: 'system', name: 'System-wide' }],
    region: [
      { id: 'region-central', name: 'Central Region' },
      { id: 'region-north', name: 'North Region' },
      { id: 'region-south', name: 'South Region' },
    ],
    outlet: [
      { id: 'outlet-001', name: 'Downtown Flagship' },
      { id: 'outlet-002', name: 'Riverside Branch' },
      { id: 'outlet-003', name: 'Mall Kiosk A' },
      { id: 'outlet-004', name: 'Uptown Express' },
      { id: 'outlet-005', name: 'Station Café' },
      { id: 'outlet-006', name: 'Harbor View' },
    ],
  };

  const personaOptions = ['System Administrator', 'Regional Manager', 'Outlet Manager', 'POS Cashier', 'Finance Lead', 'Procurement Officer', 'HR Reviewer', 'Audit Viewer'];

  const hasChanges =
    form.persona !== user.persona ||
    form.scopeLevel !== (userScope?.scopeLevel || 'outlet') ||
    form.scopeId !== (userScope?.scopeId || '') ||
    JSON.stringify(form.roles.sort()) !== JSON.stringify([...user.roles].sort());

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">← Back to User Detail</button>

      <BranchBlockedBanner />

      {/* Header */}
      <div className="surface-elevated p-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="text-sm font-bold text-primary">{user.fullName.split(' ').map(n => n[0]).join('')}</span>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">Edit — {user.fullName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono">{user.username}</span> · {user.email} · <StatusBadge status={user.status} />
            </p>
          </div>
          {hasChanges && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/8 border border-warning/15 px-2 py-0.5 rounded">
              <AlertTriangle className="h-2.5 w-2.5" />Unsaved changes
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left: Persona + Scope */}
        <div className="space-y-4">
          <div className="surface-elevated overflow-hidden">
            <div className="px-4 py-3 border-b">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5" />Persona</span>
            </div>
            <div className="p-4">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Actor Type</label>
              <select value={form.persona} onChange={e => update('persona', e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring h-8">
                {personaOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {form.persona !== user.persona && (
                <p className="text-[10px] text-warning mt-1.5 flex items-center gap-1">
                  <ArrowRight className="h-2.5 w-2.5" />Changed from <span className="font-medium">{user.persona}</span>
                </p>
              )}
            </div>
          </div>

          <div className="surface-elevated overflow-hidden">
            <div className="px-4 py-3 border-b">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />Scope Assignment</span>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Scope Level</label>
                <div className="flex gap-1.5">
                  {(['system', 'region', 'outlet'] as const).map(level => (
                    <button key={level} onClick={() => { update('scopeLevel', level); update('scopeId', ''); }}
                      className={cn('text-[11px] px-2.5 py-1.5 rounded-md border transition-colors capitalize',
                        form.scopeLevel === level ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
                      )}>
                      {level}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  {form.scopeLevel === 'system' ? 'Scope' : form.scopeLevel === 'region' ? 'Region' : 'Outlet'}
                </label>
                <select value={form.scopeId} onChange={e => update('scopeId', e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring h-8">
                  <option value="">Select...</option>
                  {scopeOptions[form.scopeLevel].map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              {userScope && (form.scopeLevel !== userScope.scopeLevel || form.scopeId !== userScope.scopeId) && (
                <p className="text-[10px] text-warning flex items-center gap-1">
                  <ArrowRight className="h-2.5 w-2.5" />Changed from <span className="font-medium">{userScope.scopeName}</span> ({userScope.scopeLevel})
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Roles */}
        <div className="surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Key className="h-3.5 w-3.5" />Role Assignment</span>
          </div>
          <div className="p-4 space-y-1">
            {mockIAMRoles.map(r => {
              const wasAssigned = user.roles.includes(r.name);
              const isAssigned = form.roles.includes(r.name);
              const changed = wasAssigned !== isAssigned;
              return (
                <label key={r.id} className={cn('flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors',
                  isAssigned ? 'bg-primary/5 border-primary/20' : 'hover:bg-muted/20 border-transparent',
                  changed && 'ring-1 ring-warning/30'
                )}>
                  <input type="checkbox" checked={isAssigned} onChange={() => toggleRole(r.name)}
                    className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-foreground font-mono">{r.name}</p>
                      {changed && (
                        <span className={cn('text-[9px] font-medium px-1.5 py-0 rounded',
                          isAssigned ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                        )}>
                          {isAssigned ? '+ added' : '− removed'}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{r.description}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{r.permissionCount} perms</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="surface-elevated p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {hasChanges ? <span className="text-warning font-medium">You have unsaved changes</span> : <span>No changes made</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onBack}><X className="h-3 w-3 mr-1" /> Cancel</Button>
            <Button size="sm" className="h-8 text-xs" disabled={!hasChanges}><Save className="h-3 w-3 mr-1" /> Save Changes</Button>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2.5 p-3 rounded-md bg-info/5 border border-info/10">
        <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-info leading-relaxed">
          User updates require the IAM service. While branch-blocked, this form shows the target-state edit UX. 
          Changes will be submitted via <code className="text-[10px] bg-muted px-1 rounded">PUT /api/iam/users/{'{userId}'}</code> once the IAM backend is available.
        </p>
      </div>
    </div>
  );
}
