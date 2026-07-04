import { Loader2, Send } from 'lucide-react';
import type { PublicMenuItemView } from '@/api/fern-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PublicOrderCartDraft, PublicOrderCartLine, PublicOrderCartSummary } from '@/lib/public-order';
import { cn } from '@/lib/utils';
import { formatCurrency } from './format';
import { QuantityStepper } from './QuantityStepper';
import { productName } from './utils';

export function CartPanel({
  variant,
  cart,
  cartSummary,
  currencyCode,
  menuByProductId,
  browseModeOrderLookupError,
  submitErrorMessage,
  submitPending,
  onUpdateCart,
  onUpdateCartLine,
  onSubmit,
}: {
  variant: 'desktop' | 'mobile';
  cart: PublicOrderCartDraft;
  cartSummary: PublicOrderCartSummary;
  currencyCode: string;
  menuByProductId: Map<string, PublicMenuItemView>;
  browseModeOrderLookupError: string | null;
  submitErrorMessage: string | null;
  submitPending: boolean;
  onUpdateCart: (recipe: (current: PublicOrderCartDraft) => PublicOrderCartDraft) => void;
  onUpdateCartLine: (
    productId: string,
    recipe: (line: PublicOrderCartLine) => PublicOrderCartLine | null,
  ) => void;
  onSubmit: () => void;
}) {
  const submitDisabled =
    submitPending
    || cart.items.length === 0
    || cartSummary.invalidProductIds.length > 0;

  return (
    <div
      className={cn(
        'flex flex-col',
        variant === 'desktop' && 'max-h-[calc(100vh-5.5rem)] rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-[57px]',
        variant === 'mobile' && 'min-h-0 flex-1',
      )}
    >
      <div
        className={cn(
          'flex flex-col',
          variant === 'desktop' && 'min-h-0 flex-1 overflow-hidden p-4',
          variant === 'mobile' && 'flex-1 overflow-y-auto',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Your order</h2>
            <p className="mt-0.5 text-xs text-slate-500">Staff will confirm before serving</p>
          </div>
          {cartSummary.itemCount > 0 ? (
            <Badge className="accent-soft-bg rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--pos-accent))]">
              {cartSummary.itemCount}
            </Badge>
          ) : null}
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {cart.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Tap <span className="font-medium text-[hsl(var(--pos-accent))]">+</span> on a dish to start your order.
            </div>
          ) : (
            cart.items.map((item) => {
              const menuItem = menuByProductId.get(item.productId);
              const unavailable = cartSummary.invalidProductIds.includes(item.productId);
              const lineTotal = menuItem ? Number(menuItem.priceValue) * item.quantity : 0;
              return (
                <div
                  key={item.productId}
                  className={cn(
                    'rounded-xl border p-3',
                    unavailable ? 'border-rose-200 bg-rose-50' : 'border-slate-100 bg-slate-50/80',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {menuItem ? productName(menuItem) : `Unavailable item`}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold tabular-nums text-[hsl(var(--pos-accent))]">
                        {menuItem ? formatCurrency(lineTotal, currencyCode) : 'Unavailable'}
                      </p>
                    </div>
                    <QuantityStepper
                      quantity={item.quantity}
                      onDecrease={() => onUpdateCartLine(item.productId, (current) => ({ ...current, quantity: current.quantity - 1 }))}
                      onIncrease={() => onUpdateCartLine(item.productId, (current) => ({ ...current, quantity: current.quantity + 1 }))}
                      decreaseLabel={`Remove one ${menuItem ? productName(menuItem) : item.productId}`}
                      increaseLabel={`Add one ${menuItem ? productName(menuItem) : item.productId}`}
                      disabledIncrease={!menuItem}
                      compact
                    />
                  </div>

                  {unavailable ? (
                    <p className="mt-2 text-xs text-rose-700">This item is no longer available. Please remove it.</p>
                  ) : (
                    <div className="mt-2">
                      <Label htmlFor={`item-note-${variant}-${item.productId}`} className="sr-only">
                        Note for {menuItem ? productName(menuItem) : 'item'}
                      </Label>
                      <Textarea
                        id={`item-note-${variant}-${item.productId}`}
                        className="min-h-[44px] resize-none border-slate-200 bg-white py-2 text-xs"
                        placeholder="Note (optional): less spicy, no ice..."
                        value={item.note}
                        onChange={(event) => onUpdateCartLine(item.productId, (current) => ({ ...current, note: event.target.value }))}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {cart.items.length > 0 ? (
          <div className="mt-3 shrink-0">
            <Label htmlFor={`order-note-${variant}`} className="text-xs font-medium text-slate-600">
              Note for staff (optional)
            </Label>
            <Textarea
              id={`order-note-${variant}`}
              className="mt-1.5 min-h-[52px] resize-none border-slate-200 bg-white text-sm"
              placeholder="Allergies, serve together, etc."
              value={cart.note}
              onChange={(event) => onUpdateCart((current) => ({ ...current, note: event.target.value }))}
            />
          </div>
        ) : null}

        {browseModeOrderLookupError ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {browseModeOrderLookupError}
          </div>
        ) : null}

        {submitErrorMessage ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
            {submitErrorMessage}
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          'shrink-0 border-t border-slate-100 bg-white p-4',
          variant === 'mobile' && 'sticky bottom-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-slate-600">Subtotal</span>
          <span className="text-lg font-bold tabular-nums text-slate-900">
            {formatCurrency(cartSummary.subtotal, currencyCode)}
          </span>
        </div>
        <Button
          className="accent-bg h-12 w-full gap-2 text-base font-semibold touch-manipulation"
          disabled={submitDisabled}
          onClick={onSubmit}
        >
          {submitPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send order
        </Button>
        <p className="mt-2 text-center text-[11px] leading-4 text-slate-500">
          Payment at the counter after staff confirms
        </p>
      </div>
    </div>
  );
}
