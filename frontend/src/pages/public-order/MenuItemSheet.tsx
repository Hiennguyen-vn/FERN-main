import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { PublicMenuItemView } from '@/api/fern-api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { formatPublicLabel } from '@/lib/public-order';
import { formatCurrency } from './format';
import { QuantityStepper } from './QuantityStepper';
import { productInitials, productName } from './utils';

export function MenuItemSheet({
  item,
  open,
  onOpenChange,
  currencyCode,
  initialQuantity,
  initialNote,
  onAddToCart,
}: {
  item: PublicMenuItemView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currencyCode: string;
  initialQuantity: number;
  initialNote: string;
  onAddToCart: (quantity: number, note: string) => void;
}) {
  const [quantity, setQuantity] = useState(Math.max(1, initialQuantity || 1));
  const [note, setNote] = useState(initialNote);

  useEffect(() => {
    if (open && item) {
      setQuantity(Math.max(1, initialQuantity || 1));
      setNote(initialNote);
    }
  }, [open, item, initialQuantity, initialNote]);

  if (!item) return null;

  const name = productName(item);
  const description = item.description
    || 'Prepared fresh for table ordering. Staff will confirm the request before service.';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92vh] flex-col rounded-t-2xl border-slate-200 bg-[hsl(var(--pos-surface))] p-0"
      >
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-300" />
        <SheetHeader className="px-4 pt-3 text-left">
          <SheetTitle className="text-lg font-semibold text-slate-900">{name}</SheetTitle>
          <SheetDescription className="text-sm text-slate-600">
            {formatPublicLabel(item.categoryCode, 'Menu')} · {formatCurrency(item.priceValue, currencyCode)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="mt-3 aspect-[4/3] overflow-hidden rounded-xl bg-[hsl(var(--pos-accent-soft))]">
            {item.imageUrl ? (
              <img src={String(item.imageUrl)} alt={name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-3xl font-semibold text-[hsl(var(--pos-accent))]">
                {productInitials(item)}
              </div>
            )}
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>

          <div className="mt-5">
            <Label htmlFor="menu-item-note" className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Item note
            </Label>
            <Textarea
              id="menu-item-note"
              className="mt-2 min-h-[60px] resize-none border-slate-200 bg-white text-sm"
              placeholder="No onions, less ice, serve later..."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-[hsl(var(--pos-surface))] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center justify-between gap-3">
            <QuantityStepper
              quantity={quantity}
              onDecrease={() => setQuantity((current) => Math.max(1, current - 1))}
              onIncrease={() => setQuantity((current) => current + 1)}
              decreaseLabel={`Decrease ${name} quantity`}
              increaseLabel={`Increase ${name} quantity`}
            />
            <Button
              className="accent-bg h-12 min-w-0 flex-1 gap-2"
              onClick={() => {
                onAddToCart(quantity, note);
                onOpenChange(false);
              }}
            >
              <ShoppingBag className="h-4 w-4 shrink-0" />
              Add to order
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
