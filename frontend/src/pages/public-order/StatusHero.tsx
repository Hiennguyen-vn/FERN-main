import { CheckCircle2, CircleAlert, Clock3, UtensilsCrossed } from 'lucide-react';
import type { PublicOrderReceiptView } from '@/api/fern-api';
import { cn } from '@/lib/utils';
import { shortPublicOrderRef } from '@/lib/public-order';
import type { PublicOrderPhase } from './public-order-phase';

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
            <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Đã thanh toán</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Cảm ơn quý khách!</h2>
            <p className="mt-2 text-sm leading-6 text-white/90">
              Đơn <span className="font-mono font-semibold">{orderRef}</span> đang được chế biến. Chúc quý khách ngon miệng.
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
            <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Sẵn sàng thanh toán</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Vui lòng thanh toán tại quầy</h2>
            <p className="mt-2 text-sm leading-6 text-white/90">
              Đưa màn hình này cho thu ngân. Nhân viên đã xác nhận đơn của bạn.
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
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">Đã hủy</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Đơn đã bị hủy</h2>
            <p className="mt-2 text-sm leading-6 text-rose-800">
              {cancelReason || 'Vui lòng hỏi nhân viên hoặc gọi món lại khi sẵn sàng.'}
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
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--pos-accent))]">Chờ xác nhận</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Đã gửi yêu cầu gọi món</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Nhân viên sẽ xác nhận trong giây lát. Giữ màn hình này — trạng thái tự cập nhật.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 font-mono text-sm font-semibold tracking-wider text-slate-900 shadow-sm">
            {orderRef}
          </p>
        </div>
      </div>
    </div>
  );
}
