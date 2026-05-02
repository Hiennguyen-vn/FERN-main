import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'default' | 'warn' | 'critical' | 'success';

export function getInitials(name: string | undefined | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function KpiCard({ icon: Icon, label, value, sub, tone = 'default' }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
}) {
  const accent = tone === 'critical'
    ? 'text-destructive'
    : tone === 'warn'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'success'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-foreground';
  return (
    <div className="rounded-md border border-border/60 bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn('font-mono text-2xl font-semibold tracking-tight tabular-nums', accent)}>{value}</span>
        {sub ? <span className="text-[10px] text-muted-foreground">{sub}</span> : null}
      </div>
    </div>
  );
}

export function KpiStrip({ children, cols = 6 }: { children: ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const cls = cols === 3
    ? 'grid grid-cols-2 gap-2.5 sm:grid-cols-3'
    : cols === 4
      ? 'grid grid-cols-2 gap-2.5 sm:grid-cols-2 lg:grid-cols-4'
      : cols === 5
        ? 'grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5'
        : 'grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6';
  return <div className={cls}>{children}</div>;
}

export function SegmentChip({ label, count, active, tone = 'default', onClick }: {
  label: string;
  count: number;
  active: boolean;
  tone?: Tone;
  onClick: () => void;
}) {
  const activeClass = tone === 'critical'
    ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : tone === 'warn'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
      : tone === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        : 'border-primary/40 bg-primary/10 text-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-full border px-3 text-[11px] font-medium transition-colors',
        active ? activeClass : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-border',
      )}
    >
      <span>{label}</span>
      <span className={cn('font-mono tabular-nums text-[10px]', active ? '' : 'text-muted-foreground/80')}>
        {count}
      </span>
    </button>
  );
}

export function SegmentChipRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

export function DeltaChip({ tone, label }: { tone: 'late' | 'early' | 'ontime' | 'missing'; label: string }) {
  const cls = tone === 'late'
    ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : tone === 'missing'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : tone === 'early'
        ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
        : 'border-border bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums', cls)}>
      {label}
    </span>
  );
}

export function ExceptionDot({ tone, title }: { tone: 'critical' | 'warn'; title: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block h-1.5 w-1.5 rounded-full',
        tone === 'critical' ? 'bg-destructive' : 'bg-amber-500',
      )}
    />
  );
}

export function DetailRow({ label, value, compact }: { label: string; value: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', compact ? 'text-[11px]' : 'text-xs')}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

export type SeverityTone = 'active' | 'expiring' | 'expired' | 'locked' | 'draft' | 'neutral';

export function SeverityPill({ tone, children }: { tone: SeverityTone; children: ReactNode }) {
  const cls = tone === 'active'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : tone === 'expiring'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
      : tone === 'expired'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : tone === 'locked'
          ? 'border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-400'
          : tone === 'draft'
            ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400'
            : 'border-border bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', cls)}>
      {children}
    </span>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function WorkspaceHeader({ title, subtitle, actions }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ExceptionBanner({ tone, icon: Icon, message, action }: {
  tone: 'warn' | 'critical' | 'info';
  icon: React.ElementType;
  message: ReactNode;
  action?: ReactNode;
}) {
  const cls = tone === 'critical'
    ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : tone === 'warn'
      ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
      : 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400';
  return (
    <div className={cn('flex items-center gap-3 rounded-md border px-3 py-2.5 text-xs', cls)}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">{message}</div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  );
}
