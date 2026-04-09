import {
  Shield, Users, Key, Globe, Eye, AlertTriangle, Lock,
  ChevronRight, ShieldAlert, GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  mockIAMUsers, mockIAMRoles, mockOverrides, mockAuthFailures,
} from '@/data/mock-iam';

type IAMView = 'dashboard' | 'users' | 'user-detail' | 'create-user' | 'edit-user' | 'roles' | 'permissions' | 'scopes' | 'overrides' | 'effective-access';

/* ── Branch-blocked banner ── */
export function BranchBlockedBanner() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-warning/8 border border-warning/15">
      <GitBranch className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs font-semibold text-foreground">IAM Service Unavailable</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
          Administrative write flows are disabled because the IAM backend dependency is not currently healthy in this environment.
        </p>
      </div>
    </div>
  );
}

/* ── Bootstrap Gap Chip ── */
export function BootstrapGapChip() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/8 border border-warning/15 px-1.5 py-0.5 rounded">
      <AlertTriangle className="h-2.5 w-2.5" />
      Not Published
    </span>
  );
}

/* ── Status Badge ── */
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-success/10 text-success',
    suspended: 'bg-warning/10 text-warning',
    locked: 'bg-destructive/10 text-destructive',
    deactivated: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${styles[status] || styles.active}`}>
      {status}
    </span>
  );
}

export function IAMDashboard({ onNavigate }: { onNavigate: (v: IAMView) => void }) {
  const totalUsers = mockIAMUsers.length;
  const activeRoles = mockIAMRoles.length;
  const lockedAccounts = mockIAMUsers.filter(u => u.status === 'locked').length;
  const overrideCount = mockOverrides.length;
  const recentFailures = mockAuthFailures.length;

  const kpis = [
    { label: 'Total Users', value: totalUsers, icon: Users },
    { label: 'Active Roles', value: activeRoles, icon: Key },
    { label: 'Locked Accounts', value: lockedAccounts, icon: Lock, highlight: lockedAccounts > 0 },
    { label: 'Active Overrides', value: overrideCount, icon: ShieldAlert, highlight: overrideCount > 0 },
    { label: 'Auth Failures (7d)', value: recentFailures, icon: AlertTriangle, highlight: recentFailures > 2 },
  ];

  const quickLinks = [
    { label: 'Users', view: 'users' as IAMView, icon: Users },
    { label: 'Roles', view: 'roles' as IAMView, icon: Key },
    { label: 'Permissions', view: 'permissions' as IAMView, icon: Shield },
    { label: 'Scopes', view: 'scopes' as IAMView, icon: Globe },
    { label: 'Overrides', view: 'overrides' as IAMView, icon: ShieldAlert },
    { label: 'Effective Access', view: 'effective-access' as IAMView, icon: Eye },
  ];

  return (
    <div className="space-y-6">
      <BranchBlockedBanner />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <k.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</span>
              {k.highlight && <span className="h-2 w-2 rounded-full bg-warning animate-pulse ml-auto" />}
            </div>
            <p className="text-xl font-semibold text-foreground">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Quick Links + System Health */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Administration</h3>
          <div className="grid grid-cols-3 gap-2">
            {quickLinks.map(l => (
              <button
                key={l.label}
                onClick={() => onNavigate(l.view)}
                className="surface-elevated p-3 flex items-center gap-2.5 hover:border-primary/20 transition-colors text-left"
              >
                <l.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">{l.label}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto" />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">System Health</h3>
          <div className="surface-elevated p-4 space-y-2.5">
            {[
              { label: 'Auth Service', status: 'blocked', detail: 'Dependency is not healthy' },
              { label: 'User Store', status: 'available', detail: 'Read operations available' },
              { label: 'Permission Engine', status: 'blocked', detail: 'Awaiting IAM backend recovery' },
              { label: 'Session Manager', status: 'degraded', detail: 'Session flows remain available through gateway' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2.5 py-1.5">
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  s.status === 'available' ? 'bg-success' : s.status === 'degraded' ? 'bg-warning' : 'bg-destructive'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Auth Failures */}
      <div className="surface-elevated overflow-hidden">
        <div className="px-4 py-3 border-b">
          <span className="text-sm font-semibold text-foreground">Recent Authentication Failures</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Username', 'IP', 'Reason', 'Time'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockAuthFailures.map(f => (
              <tr key={f.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 text-sm font-mono text-foreground">{f.username}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{f.ip}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{f.reason}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(f.timestamp).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
