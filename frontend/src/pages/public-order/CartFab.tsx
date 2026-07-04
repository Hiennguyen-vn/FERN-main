import { ShoppingBag } from 'lucide-react';
import { CartPanel } from './CartPanel';
import { formatCurrency } from './format';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { PublicMenuItemView } from '@/api/fern-api';
import type { PublicOrderCartDraft, PublicOrderCartLine, PublicOrderCartSummary } from '@/lib/public-order';

export function CartFab({
  itemCount,
  subtotal,
  currencyCode,
  onOpenCart,
}: {
  itemCount: number;
  subtotal: number;
  currencyCode: string;
  onOpenCart: () => void;
}) {
  if (itemCount === 0) return null;

  return (
    <button
      type="button"
      className="accent-bg fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex min-h-[52px] touch-manipulation items-center justify-between gap-4 rounded-2xl px-5 py-3 text-left shadow-lg"
      onClick={onOpenCart}
      aria-label={`View order, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
    >
      <span className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <ShoppingBag className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold">
          {itemCount} item{itemCount === 1 ? '' : 's'}
        </span>
      </span>
      <span className="text-sm font-bold tabular-nums">{formatCurrency(subtotal, currencyCode)}</span>
    </button>
  );
}

export function CartMobileSheet({
  open,
  onOpenChange,
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92vh] flex-col rounded-t-2xl border-slate-200 bg-white p-0"
      >
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-300" />
        <SheetHeader className="sr-only">
          <SheetTitle>Your order</SheetTitle>
          <SheetDescription>Review dishes before sending to staff.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CartPanel
            variant="mobile"
            cart={cart}
            cartSummary={cartSummary}
            currencyCode={currencyCode}
            menuByProductId={menuByProductId}
            browseModeOrderLookupError={browseModeOrderLookupError}
            submitErrorMessage={submitErrorMessage}
            submitPending={submitPending}
            onUpdateCart={onUpdateCart}
            onUpdateCartLine={onUpdateCartLine}
            onSubmit={onSubmit}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
