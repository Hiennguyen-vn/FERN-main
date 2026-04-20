import { CheckCircle2, CircleAlert, Clock3, UtensilsCrossed } from 'lucide-react';
import type { PublicOrderReceiptView } from '@/api/fern-api';
import { cn } from '@/lib/utils';
import { shortPublicOrderRef } from '@/lib/public-order';

export type PublicOrderPhase = 'pending' | 'approved' | 'paid' | 'cancelled';

export function derivePublicOrderPhase(receipt: PublicOrderReceiptView | null | undefined): PublicOrderPhase {
  if (!receipt) return 'pending';
  const status = String(receipt.orderStatus || '').toLowerCase();
  const payment = String(receipt.paymentStatus || '').toLowerCase();
  if (status.includes('cancel') || status.includes('reject') || status.includes('void')) return 'cancelled';
  if (payment === 'paid' || status.includes('payment_done')) return 'paid';
  if (status.includes('approved') || status.includes('confirmed') || status.includes('completed')) return 'approved';
  return 'pending';
}

export function StatusHero({
  phase,
  receipt,
  animationKey,
}: {
  phase: PublicOrderPhase;
  receipt: PublicOrderReceiptView;
  animationKey: number;
}) {
  const orderRef = shortPublicOrderRef(receipt.orderToken);
  const cancelReason = String(receipt.note || '').trim();

  if (phase === 'paid') {
    return (
      <div key={animationKey} className="success-bg pop rounded-2xl px-6 py-6 text-white shadow-md">
        <div className="flex items-start gap-4">
          <CheckCircle2 className="h-10 w-10 shrink-0" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/80">Payment received</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Thank you — payment complete</h2>
            <p className="mt-2 text-sm leading-6 text-white/90">
              Your order <span className="font-mono font-semibold">{orderRef}</span> is being prepared. Enjoy your meal.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'approved') {
    return (
      <div className="accent-bg rounded-2xl px-6 py-6 text-white shadow-md">
        <div className="flex items-start gap-4">
          <div className="pulse-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
            <UtensilsCrossed className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/80">Ready to settle</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Please pay at the counter</h2>
            <p className="mt-2 text-sm leading-6 text-white/90">
              Show this screen to the cashier to complete payment. Staff has accepted your order.
            </p>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 font-mono text-sm font-semibold tracking-wider">
              {orderRef}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'cancelled') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-6 text-rose-900 shadow-sm">
        <div className="flex items-start gap-4">
          <CircleAlert className="h-10 w-10 shrink-0 text-rose-500" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-rose-600">Order cancelled</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Staff cancelled this order</h2>
            <p className="mt-2 text-sm leading-6 text-rose-800">
              {cancelReason || 'Ask staff for details or submit a new request when ready.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('accent-soft-bg rounded-2xl px-6 py-6 shadow-sm')}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-[hsl(var(--pos-accent))] shadow-sm">
          <Clock3 className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[hsl(var(--pos-accent))]">Sent to staff</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Order received by the kitchen</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Staff will confirm shortly. Keep this screen open — status updates automatically.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 font-mono text-sm font-semibold tracking-wider text-slate-900 shadow-sm">
            {orderRef}
          </p>
        </div>
      </div>
    </div>
  );
}
