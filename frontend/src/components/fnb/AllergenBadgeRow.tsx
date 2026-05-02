import type { ProductAllergenView } from '@/api/fnb-api';

interface Props {
  allergens: ProductAllergenView[];
  size?: 'xs' | 'sm';
  showLabel?: boolean;
}

export function AllergenBadgeRow({ allergens, size = 'xs', showLabel = false }: Props) {
  if (!allergens || allergens.length === 0) return null;
  const fontClass = size === 'sm' ? 'text-xs' : 'text-[10px]';
  return (
    <div className="flex flex-wrap gap-1">
      {allergens.map((a) => (
        <span
          key={a.code}
          title={`${a.label}${a.isTraces ? ' (vết)' : ''}`}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border ${fontClass} ${
            a.isTraces
              ? 'bg-warning/10 border-warning/30 text-warning'
              : 'bg-destructive/10 border-destructive/20 text-destructive'
          }`}
        >
          {a.icon ? <span aria-hidden>{a.icon}</span> : <span aria-hidden className="font-mono">!</span>}
          {showLabel && <span>{a.label}</span>}
          {a.isTraces && <span className="font-mono">~</span>}
        </span>
      ))}
    </div>
  );
}
