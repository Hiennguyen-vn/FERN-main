import { useMemo, useState } from 'react';
import { Coffee, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { PosMenuItem } from '../hooks/use-pos-menu';
import { formatVnd } from '../utils/format';

interface Props {
  category: string;
  items: PosMenuItem[];
  onPick: (item: PosMenuItem) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}

export function MenuGrid({ category, items, onPick, isLoading, emptyMessage }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = category === 'all' ? items : items.filter((m) => m.categoryCode === category);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [items, category, query]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[hsl(var(--pos-bg))]">
      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm món..."
            className="pl-9 h-11 bg-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border overflow-hidden">
                <div className="aspect-[4/3] bg-muted animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">
            {emptyMessage ?? 'Không có món phù hợp'}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((m) => {
              const disabled = !m.isAvailable;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => !disabled && onPick(m)}
                  className={`pos-card-item text-left bg-white rounded-xl border overflow-hidden flex flex-col ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={disabled ? 'Chưa có giá cho outlet này' : undefined}
                >
                  <div className="relative aspect-[4/3] bg-muted flex items-center justify-center text-muted-foreground">
                    {m.imageUrl ? (
                      <img
                        src={m.imageUrl}
                        alt={m.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <Coffee className="w-8 h-8 opacity-40" />
                    )}
                    {disabled && (
                      <span className="absolute top-2 left-2 bg-destructive/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        Chưa có giá
                      </span>
                    )}
                  </div>
                  <div className="p-3 flex-1 flex flex-col gap-1">
                    <div className="text-sm font-medium line-clamp-2 min-h-[2.5em]">{m.name}</div>
                    <div className="pos-accent-text font-bold">{formatVnd(m.price)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
