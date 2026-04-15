import { cn } from '@/lib/utils';

export type SourceType = 'base' | 'inherited' | 'overridden' | 'conflict';

const SOURCE_CONFIG: Record<SourceType, { label: string; prefix: string; style: string }> = {
  base: { label: 'base', prefix: '', style: 'bg-muted/60 text-muted-foreground' },
  inherited: { label: 'inherited', prefix: '↓', style: 'bg-sky-50 text-sky-600' },
  overridden: { label: 'overridden', prefix: '✎', style: 'bg-amber-50 text-amber-700' },
  conflict: { label: 'conflict', prefix: '⚠', style: 'bg-rose-50 text-rose-600' },
};

interface SourceBadgeProps {
  source: SourceType;
  scopeLabel?: string;
  className?: string;
}

export function SourceBadge({ source, scopeLabel, className }: SourceBadgeProps) {
  const cfg = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.base;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        cfg.style,
        className,
      )}
    >
      {cfg.prefix && <span>{cfg.prefix}</span>}
      {scopeLabel ?? cfg.label}
    </span>
  );
}
