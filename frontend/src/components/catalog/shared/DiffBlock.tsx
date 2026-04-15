import { cn } from '@/lib/utils';

interface DiffBlockProps {
  label: string;
  before: string | null;
  after: string | null;
  className?: string;
}

export function DiffBlock({ label, before, after, className }: DiffBlockProps) {
  const changed = before !== after;
  return (
    <div className={cn('border rounded-lg overflow-hidden', className)}>
      <div className="px-3 py-1.5 bg-muted/30 border-b">
        <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
      </div>
      <div className="grid grid-cols-2 divide-x">
        <div className="p-3">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Current</p>
          <p className={cn('text-xs font-mono', changed && 'text-rose-600 line-through')}>{before || '—'}</p>
        </div>
        <div className="p-3">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">After Publish</p>
          <p className={cn('text-xs font-mono', changed && 'text-emerald-600 font-medium')}>{after || '—'}</p>
        </div>
      </div>
    </div>
  );
}
