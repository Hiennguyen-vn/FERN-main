import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImpactCardProps {
  items: { label: string; count: number }[];
  className?: string;
}

export function ImpactCard({ items, className }: ImpactCardProps) {
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className={cn('border rounded-lg', className)}>
      <div className="px-3 py-2 border-b bg-amber-50/50 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Impact Preview</p>
        <span className="text-[10px] text-amber-600 ml-auto">{total} total changes</span>
      </div>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map(item => (
          <div key={item.label} className="text-center">
            <p className="text-lg font-semibold">{item.count}</p>
            <p className="text-[10px] text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
