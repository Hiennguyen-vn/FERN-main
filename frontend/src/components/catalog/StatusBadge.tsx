import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  draft: 'bg-amber-100 text-amber-700',
  inactive: 'bg-muted text-muted-foreground',
  discontinued: 'bg-rose-100 text-rose-700',
  archived: 'bg-slate-100 text-slate-600',
  expired: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-rose-100 text-rose-700',
  scheduled: 'bg-sky-100 text-sky-700',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = String(status || 'draft');
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', STATUS_STYLES[s] || STATUS_STYLES.draft, className)}>
      {s}
    </span>
  );
}
