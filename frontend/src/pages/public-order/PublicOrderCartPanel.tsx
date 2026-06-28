import { useState } from 'react';
import { BellRing, Loader2, Minus, Plus } from 'lucide-react';
import type { PublicMenuItemView } from '@/api/fern-api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { PublicOrderCartDraft, PublicOrderCartSummary } from '@/lib/public-order';
import { cn } from '@/lib/utils';
import { formatPublicCurrency, productDisplayName } from './public-order-format';

export function PublicOrderCartPanel({
  variant,
  cart,
  cartSummary,
  menuByProductId,
  currencyCode,
  reviewRequired,
  submitErrorMessage,
  browseModeOrderLookupError,
  submitting,
  onUpdateCart,
  onUpdateLine,
  onSubmit,
}: {
  variant: 'desktop' | 'mobile' | 'sheet';
  cart: PublicOrderCartDraft;
  cartSummary: PublicOrderCartSummary;
  menuByProductId: ReadonlyMap<string, PublicMenuItemView>;
  currencyCode: string;
  reviewRequired: boolean;
  submitErrorMessage: string | null;
  browseModeOrderLookupError: string | null;
  submitting: boolean;
  onUpdateCart: (recipe: (current: PublicOrderCartDraft) => PublicOrderCartDraft) => void;
  onUpdateLine: (
    productId: string,
    recipe: (line: { productId: string; quantity: number; note: string }) => { productId: string; quantity: number; note: string } | null,
  ) => void;
  onSubmit: () => void;
}) {
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const canSubmit = !submitting
    && cart.items.length > 0
    && cartSummary.invalidProductIds.length === 0
    && !reviewRequired;

  return (
    <div className={cn('po-cart-panel', variant === 'desktop' && 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--pos-accent))]">Giỏ gọi món</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">Món đã chọn</h2>
        </div>
        <span className="rounded-full bg-[hsl(var(--pos-accent-soft))] px-3 py-1 text-xs font-bold text-[hsl(var(--pos-accent))]">
          {cartSummary.itemCount} món
        </span>
      </div>

      <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
        {cart.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[hsl(var(--pos-accent)/0.3)] bg-[hsl(var(--pos-accent-soft)/0.5)] px-4 py-8 text-center text-sm leading-6 text-slate-600">
            Chọn món từ thực đơn bên trái, sau đó bấm <strong>Gọi món</strong> để gửi yêu cầu đến bếp.
          </div>
        ) : (
          cart.items.map((item) => {
            const menuItem = menuByProductId.get(item.productId);
            const invalid = cartSummary.invalidProductIds.includes(item.productId) || reviewRequired;
            const name = menuItem ? productDisplayName(menuItem) : `Món #${item.productId}`;
            const noteOpen = expandedNotes[item.productId] || Boolean(item.note.trim());

            return (
              <div key={item.productId} className={cn('po-cart-line', invalid && 'is-invalid')}>
                <div className="po-cart-line-body">
                  <p className="po-cart-line-name">{name}</p>
                  <p className="po-cart-line-price">
                    {menuItem
                      ? formatPublicCurrency(menuItem.priceValue, currencyCode)
                      : 'Món không còn — vui lòng xóa'}
                  </p>
                  <button
                    type="button"
                    className="po-note-toggle"
                    onClick={() => setExpandedNotes((prev) => ({ ...prev, [item.productId]: !noteOpen }))}
                  >
                    {noteOpen ? 'Ẩn ghi chú' : '+ Ghi chú món'}
                  </button>
                  {noteOpen ? (
                    <Textarea
                      className="mt-2 min-h-[4rem] resize-none border-slate-200 text-sm"
                      placeholder="Ít đá, không hành, làm sau..."
                      value={item.note}
                      onChange={(e) => onUpdateLine(item.productId, (current) => ({ ...current, note: e.target.value }))}
                    />
                  ) : null}
                  {invalid ? (
                    <p className="mt-2 text-xs text-[hsl(var(--pos-accent))]">Món này cần kiểm tra lại trước khi gọi.</p>
                  ) : null}
                </div>
                <div className="po-stepper self-start">
                  <button
                    type="button"
                    className="po-stepper-btn"
                    onClick={() => onUpdateLine(item.productId, (current) => ({ ...current, quantity: current.quantity - 1 }))}
                    aria-label={`Giảm ${name}`}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="po-stepper-qty">{item.quantity}</span>
                  <button
                    type="button"
                    className="po-stepper-btn"
                    onClick={() => onUpdateLine(item.productId, (current) => ({ ...current, quantity: current.quantity + 1 }))}
                    aria-label={`Tăng ${name}`}
                    disabled={!menuItem}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4">
        <Label htmlFor={`order-note-${variant}`} className="text-xs font-semibold text-slate-500">
          Ghi chú cho bàn
        </Label>
        <Textarea
          id={`order-note-${variant}`}
          className="mt-1.5 min-h-[4.5rem] resize-none border-slate-200 bg-slate-50 text-sm"
          placeholder="Nhờ nhân viên biết thêm về bàn này..."
          value={cart.note}
          onChange={(e) => onUpdateCart((current) => ({ ...current, note: e.target.value }))}
        />
      </div>

      {browseModeOrderLookupError ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {browseModeOrderLookupError}
        </div>
      ) : null}

      {submitErrorMessage ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {submitErrorMessage}
        </div>
      ) : null}

      <Separator className="my-4" />

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">Tạm tính</span>
        <span className="text-lg font-bold text-slate-900">{formatPublicCurrency(cartSummary.subtotal, currencyCode)}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Thanh toán tại quầy. Gọi món sẽ gửi yêu cầu đến nhân viên xác nhận.
      </p>

      <Button
        className="accent-bg mt-4 h-12 w-full gap-2 text-base font-bold"
        disabled={!canSubmit}
        onClick={onSubmit}
        data-testid="call-order-button"
      >
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <BellRing className="h-5 w-5" />}
        Gọi món
      </Button>
    </div>
  );
}

export function PublicOrderCartBar({
  itemCount,
  subtotal,
  currencyCode,
  disabled,
  onOpenCart,
  onSubmit,
}: {
  itemCount: number;
  subtotal: number;
  currencyCode: string;
  disabled: boolean;
  onOpenCart: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="po-cart-bar lg:hidden">
      <div className="po-cart-bar-inner">
        <button type="button" className="po-cart-summary" onClick={onOpenCart}>
          <p className="po-cart-summary-label">Đã chọn</p>
          <p className="po-cart-summary-value">
            {itemCount} món · {formatPublicCurrency(subtotal, currencyCode)}
          </p>
        </button>
        <button
          type="button"
          className="po-call-order-btn"
          disabled={disabled}
          onClick={onSubmit}
        >
          Gọi món
          {itemCount > 0 ? <span className="po-cart-badge">{itemCount}</span> : null}
        </button>
      </div>
    </div>
  );
}
