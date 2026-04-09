import {
  ShieldOff, Eye, Lock, EyeOff, Download, Globe, ServerCrash, GitBranch, Info,
} from 'lucide-react';
import type { PermissionState } from '@/types/shell';

interface PermissionBannerProps {
  state: PermissionState;
  moduleName?: string;
  detail?: string;
}

const STATE_CONFIG: Record<PermissionState, {
  icon: React.ElementType;
  title: string;
  description: string;
  className: string;
}> = {
  full_access: {
    icon: Info,
    title: 'Full access',
    description: '',
    className: '',
  },
  read_only: {
    icon: Eye,
    title: 'View-only access',
    description: 'You can view this data but cannot make changes. Contact your administrator to request edit permissions.',
    className: 'permission-banner permission-banner-readonly',
  },
  action_disabled: {
    icon: Lock,
    title: 'Action unavailable',
    description: 'This action requires a specific permission that is not assigned to your current role.',
    className: 'permission-banner permission-banner-readonly',
  },
  field_masked: {
    icon: EyeOff,
    title: 'Restricted field',
    description: 'Some fields in this view are masked based on your permission level.',
    className: 'permission-banner permission-banner-readonly',
  },
  export_unavailable: {
    icon: Download,
    title: 'Export not available',
    description: 'Your current role does not include export permissions for this data.',
    className: 'permission-banner permission-banner-readonly',
  },
  scope_mismatch: {
    icon: Globe,
    title: 'Scope mismatch',
    description: 'This content is outside your current scope. Adjust your scope selection to access this data.',
    className: 'permission-banner permission-banner-blocked',
  },
  route_unavailable: {
    icon: ServerCrash,
    title: 'Route not available',
    description: 'This API route is not currently exposed by the gateway. This module may be pending deployment.',
    className: 'permission-banner permission-banner-unavailable',
  },
  service_unavailable: {
    icon: ServerCrash,
    title: 'Service temporarily unavailable',
    description: 'The backend service for this module is currently unreachable. Our team has been notified.',
    className: 'permission-banner permission-banner-unavailable',
  },
  branch_blocked: {
    icon: GitBranch,
    title: 'Environment startup blocked',
    description: 'This module is unavailable because its backend dependency has not finished startup in the current environment.',
    className: 'permission-banner permission-banner-blocked',
  },
  hidden: {
    icon: ShieldOff,
    title: 'Module not available',
    description: 'This module is not visible with your current permissions.',
    className: 'permission-banner permission-banner-unavailable',
  },
};

export function PermissionBanner({ state, moduleName, detail }: PermissionBannerProps) {
  if (state === 'full_access') return null;

  const config = STATE_CONFIG[state];
  const Icon = config.icon;

  return (
    <div className={config.className}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <div>
        <p className="font-medium text-sm">
          {moduleName ? `${moduleName} — ` : ''}{config.title}
        </p>
        <p className="text-xs mt-0.5 opacity-80">
          {detail || config.description}
        </p>
      </div>
    </div>
  );
}

/** Full-page state for unavailable modules */
export function ServiceUnavailablePage({
  state,
  moduleName,
}: {
  state: 'route_unavailable' | 'service_unavailable' | 'branch_blocked';
  moduleName: string;
}) {
  const config = STATE_CONFIG[state];
  const Icon = config.icon;

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md animate-fade-in">
        <div className="mx-auto h-14 w-14 rounded-xl bg-muted flex items-center justify-center mb-5">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">{moduleName}</h2>
        <p className="text-sm font-medium text-muted-foreground mb-1">{config.title}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{config.description}</p>
        {state === 'branch_blocked' && (
          <div className="mt-5 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/8 border border-warning/15 text-xs text-warning-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            Backend dependency still starting
          </div>
        )}
      </div>
    </div>
  );
}

/** Empty state — no data (distinct from no permission) */
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-sm animate-fade-in">
        <div className="mx-auto h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-4">
          <Info className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
