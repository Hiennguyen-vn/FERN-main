import { ArrowRight, Loader2, RefreshCcw } from 'lucide-react';
import type { PublicOrderReceiptView } from '@/api/fern-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPublicLabel, shortPublicOrderRef } from '@/lib/public-order';
import { cn } from '@/lib/utils';
import { StatusHero } from './StatusHero';
import type { PublicOrderPhase } from './public-order-phase';
import { formatCurrency, formatDateTime } from './format';
import { statusBadgeClass } from './utils';

function ReceiptMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

export function ReceiptPanel({
  receipt,
  currencyCode,
  canContinueOrdering,
  onContinueOrdering,
  onRefresh,
  refreshPending,
  tableUnavailableMessage,
  phase,
  phaseAnimationKey,
}: {
  receipt: PublicOrderReceiptView;
  currencyCode: string;
  canContinueOrdering: boolean;
  onContinueOrdering: () => void;
  onRefresh: () => void;
  refreshPending: boolean;
  tableUnavailableMessage: string | null;
  phase: PublicOrderPhase;
  phaseAnimationKey: number;
}) {
  return (
    <>
      <section className="mx-auto grid max-w-5xl gap-6 pb-24 lg:grid-cols-[minmax(0,1.15fr)_360px] lg:pb-0">
        <div className="space-y-5">
          <StatusHero phase={phase} receipt={receipt} animationKey={phaseAnimationKey} />

          <div className="rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] p-4 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[hsl(var(--pos-accent))]">Table order</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                  {receipt.tableName || receipt.tableCode || 'Table order'}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className={cn('rounded-full border px-3 py-1 text-[11px] font-semibold', statusBadgeClass(receipt.orderStatus))}>
                  {formatPublicLabel(receipt.orderStatus, 'Order status')}
                </Badge>
                <Badge className={cn('rounded-full border px-3 py-1 text-[11px] font-semibold', statusBadgeClass(receipt.paymentStatus))}>
                  {formatPublicLabel(receipt.paymentStatus, 'Payment status')}
                </Badge>
              </div>
            </div>

            <div className="mt-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
              <ReceiptMeta label="Order ref" value={shortPublicOrderRef(receipt.orderToken)} />
              <ReceiptMeta label="Outlet" value={String(receipt.outletName || receipt.outletCode || '—')} />
              <ReceiptMeta label="Placed at" value={formatDateTime(receipt.createdAt)} />
              <ReceiptMeta label="Total" value={formatCurrency(receipt.totalAmount, currencyCode)} />
            </div>

            {receipt.note && phase !== 'cancelled' ? (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Order note</p>
                <p className="mt-2 whitespace-pre-wrap">{receipt.note}</p>
              </div>
            ) : null}

            <div className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Submitted items</p>
              <div className="mt-3 space-y-2">
                {(receipt.items || []).map((item) => (
                  <div
                    key={`${item.productId || item.productCode}-${item.note || ''}`}
                    className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {String(item.productName || item.productCode || item.productId || 'Menu item')}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {String(item.quantity || 0)} x {formatCurrency(item.unitPrice, currencyCode)}
                      </p>
                      {item.note ? <p className="mt-2 text-xs text-slate-600">Note: {item.note}</p> : null}
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-slate-900">{formatCurrency(item.lineTotal, currencyCode)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="hidden space-y-4 lg:sticky lg:top-6 lg:block lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--pos-accent))]">Status refresh</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {phase === 'approved'
                ? 'This screen flips to a confirmation once the cashier records your payment at the counter.'
                : 'This receipt refreshes automatically while the page is visible. Use manual refresh if staff just updated the order.'}
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <Button variant="outline" className="h-11 justify-center gap-2" onClick={onRefresh} disabled={refreshPending}>
                {refreshPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Refresh status
              </Button>
              <Button className="accent-bg h-11 justify-center gap-2" onClick={onContinueOrdering} disabled={!canContinueOrdering}>
                Continue ordering
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            {tableUnavailableMessage ? <p className="mt-3 text-xs leading-5 text-[hsl(var(--pos-accent))]">{tableUnavailableMessage}</p> : null}
          </div>

          <div className="accent-soft-bg rounded-2xl border border-[hsl(var(--pos-accent)/0.2)] px-5 py-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--pos-accent))]">What happens next</p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              Request is in the staff queue. Cashier approves, kitchen prepares, and payment is collected at the counter.
            </p>
          </div>
        </aside>
      </section>

      {/* Mobile sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-[hsl(var(--pos-surface))] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-5xl gap-3">
          <Button
            variant="outline"
            className="h-11 min-h-[44px] flex-1 touch-manipulation gap-2"
            onClick={onRefresh}
            disabled={refreshPending}
          >
            {refreshPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </Button>
          <Button
            className="accent-bg h-11 min-h-[44px] flex-1 touch-manipulation gap-2"
            onClick={onContinueOrdering}
            disabled={!canContinueOrdering}
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        {tableUnavailableMessage ? (
          <p className="mt-2 text-center text-xs leading-5 text-[hsl(var(--pos-accent))]">{tableUnavailableMessage}</p>
        ) : null}
      </div>
    </>
  );
}
