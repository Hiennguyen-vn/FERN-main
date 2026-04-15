import { cn } from '@/lib/utils';

type ScopeLevel = 'corporate' | 'region' | 'outlet' | 'channel' | 'daypart';

const SCOPE_STYLES: Record<ScopeLevel, string> = {
  corporate: 'bg-violet-50 text-violet-700 border-violet-200',
  region: 'bg-blue-50 text-blue-700 border-blue-200',
  outlet: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  channel: 'bg-amber-50 text-amber-700 border-amber-200',
  daypart: 'bg-rose-50 text-rose-700 border-rose-200',
};

interface ScopePillProps {
  level: ScopeLevel;
  label: string;
  className?: string;
}

export function ScopePill({ level, label, className }: ScopePillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium',
        SCOPE_STYLES[level] ?? SCOPE_STYLES.outlet,
        className,
      )}
    >
      {label}
    </span>
  );
}
