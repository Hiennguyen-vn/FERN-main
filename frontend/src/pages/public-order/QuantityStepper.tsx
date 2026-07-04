import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function QuantityStepper({
  quantity,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
  disabledIncrease = false,
  compact = false,
}: {
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  disabledIncrease?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white',
        compact ? 'px-1 py-0.5' : 'px-1.5 py-1',
      )}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
        onClick={onDecrease}
        aria-label={decreaseLabel}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-[1.75rem] text-center text-sm font-semibold text-slate-900">{quantity}</span>
      <button
        type="button"
        className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
        onClick={onIncrease}
        aria-label={increaseLabel}
        disabled={disabledIncrease}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
