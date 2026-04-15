import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface DependencyItem {
  label: string;
  count: number;
  total?: number;
  icon: React.ElementType;
  warning?: boolean;
}

interface DependencyCardProps {
  items: DependencyItem[];
  className?: string;
}

export function DependencyCard({ items, className }: DependencyCardProps) {
  const warnings = items.filter(i => i.warning);

  return (
    <div className={cn('border rounded-lg', className)}>
      <div className="px-3 py-2 border-b bg-muted/20">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dependencies</p>
      </div>
      <div className="divide-y">
        {items.map((item) => (
          <div key={item.label} className="px-3 py-2 flex items-center gap-2.5">
            <item.icon className={cn('h-3.5 w-3.5 flex-shrink-0', item.warning ? 'text-amber-500' : 'text-muted-foreground')} />
            <span className="text-xs flex-1">{item.label}</span>
            <span className={cn('text-xs font-mono', item.warning ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
              {item.total != null ? `${item.count}/${item.total}` : item.count}
            </span>
          </div>
        ))}
      </div>
      {warnings.length > 0 && (
        <div className="px-3 py-2 border-t bg-amber-50/50">
          {warnings.map((w) => (
            <p key={w.label} className="text-[10px] text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5" />
              {w.total != null
                ? `${w.total - w.count} ${w.label.toLowerCase()} missing`
                : `${w.count} ${w.label.toLowerCase()} need attention`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
