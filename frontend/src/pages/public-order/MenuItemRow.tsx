import { Plus } from 'lucide-react';
import type { PublicMenuItemView } from '@/api/fern-api';
import { cn } from '@/lib/utils';
import { formatCurrency } from './format';
import { QuantityStepper } from './QuantityStepper';
import { cartLineSelectedClass, productInitials, productName } from './utils';

export function MenuItemRow({
  item,
  currencyCode,
  quantity,
  onOpenDetail,
  onQuickAdd,
  onDecrease,
  onIncrease,
}: {
  item: PublicMenuItemView;
  currencyCode: string;
  quantity: number;
  onOpenDetail: () => void;
  onQuickAdd: () => void;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  const name = productName(item);
  const selected = quantity > 0;
  const subtitle = item.description?.trim() || null;

  return (
    <article
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-2xl border p-2.5 shadow-sm transition active:scale-[0.99]',
        cartLineSelectedClass(selected),
        !selected && 'hover:border-[hsl(var(--pos-accent)/0.3)]',
      )}
      onClick={onOpenDetail}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetail();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`View ${name}`}
    >
      <div className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-xl bg-[hsl(var(--pos-accent-soft))]">
        {item.imageUrl ? (
          <img src={String(item.imageUrl)} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-bold tracking-wide text-[hsl(var(--pos-accent))]">
            {productInitials(item)}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-1 text-[15px] font-semibold leading-tight text-slate-900">{name}</p>
          <p className="shrink-0 text-sm font-bold tabular-nums text-[hsl(var(--pos-accent))]">
            {formatCurrency(item.priceValue, currencyCode)}
          </p>
        </div>
        {subtitle ? (
          <p className="mt-0.5 line-clamp-1 text-xs leading-4 text-slate-500">{subtitle}</p>
        ) : null}
      </div>

      <div className="shrink-0" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        {selected ? (
          <QuantityStepper
            quantity={quantity}
            onDecrease={onDecrease}
            onIncrease={onIncrease}
            decreaseLabel={`Remove one ${name}`}
            increaseLabel={`Add one ${name}`}
            compact
          />
        ) : (
          <button
            type="button"
            className="accent-bg inline-flex h-10 w-10 min-h-[40px] min-w-[40px] touch-manipulation items-center justify-center rounded-full shadow-sm"
            onClick={onQuickAdd}
            aria-label={`Quick add ${name}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    </article>
  );
}
