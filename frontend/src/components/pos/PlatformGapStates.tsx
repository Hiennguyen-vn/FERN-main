import {
  AlertTriangle, Route, ShieldAlert, GitBranch, Info, Lock, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ── Route Unavailable ── */
export function RouteUnavailableBanner({ title, subtitle, routePath, missingPermissions }: {
  title: string;
  subtitle: string;
  routePath: string;
  missingPermissions?: string[];
}) {
  return (
    <div className="surface-elevated p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
          <Route className="h-5 w-5 text-warning" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
        </div>
      </div>

      <div className="bg-muted/30 rounded-lg p-4 space-y-3">
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Expected Gateway Route</p>
          <code className="text-xs text-foreground bg-muted px-2 py-1 rounded font-mono">{routePath}</code>
        </div>
        {missingPermissions && missingPermissions.length > 0 && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Pending IAM Bootstrap</p>
            <div className="flex flex-wrap gap-1.5">
              {missingPermissions.map(p => (
                <code key={p} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{p}</code>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-info/5 border border-info/10">
        <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-info leading-relaxed">
          This feature depends on backend capabilities that are not currently enabled in this environment.
        </p>
      </div>
    </div>
  );
}

/* ── Permission Bootstrap Unavailable ── */
export function PermissionBootstrapBanner({ feature, permissions }: {
  feature: string;
  permissions: string[];
}) {
  return (
    <div className="surface-elevated p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0">
          <ShieldAlert className="h-5 w-5 text-destructive" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Permission Bootstrap Pending</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {feature} requires IAM permission definitions that have not yet been bootstrapped into the production database.
          </p>
        </div>
      </div>

      <div className="bg-muted/30 rounded-lg p-4">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Required Permissions</p>
        <div className="flex flex-wrap gap-1.5">
          {permissions.map(p => (
            <span key={p} className="text-[10px] font-medium text-destructive/80 bg-destructive/5 px-2 py-0.5 rounded border border-destructive/10">
              {p}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The IAM backend must be healthy before these permissions become available in this environment.
        </p>
      </div>
    </div>
  );
}

/* ── Compact inline route-gap chip ── */
export function RouteGapChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/5 border border-warning/15 px-2 py-0.5 rounded">
      <Route className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

/* ── Preview / Branch Blocked ── */
export function PreviewBlockedBanner({ context }: { context?: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border">
      <Lock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs font-semibold text-foreground">Limited Environment</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
          {context || 'This feature is temporarily restricted because a required backend capability is not available in the current environment.'}
        </p>
      </div>
    </div>
  );
}
