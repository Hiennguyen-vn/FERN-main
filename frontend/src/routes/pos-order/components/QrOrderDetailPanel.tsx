import { CheckCircle2, CreditCard, Loader2, QrCode, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SaleDetailView, SaleListItemView } from '@/api/sales-api';
import { getCustomerOrderQueueFilter } from '@/components/pos/customer-order-queue';
import type { PosMenuItem } from '../hooks/use-pos-menu';
import { formatVnd } from '../utils/format';

interface Props {
  order: SaleDetailView | SaleListItemView | null;
  isLoading: boolean;
  menu: PosMenuItem[];
  approveBusy: boolean;
  cancelBusy: boolean;
  onApprove: (saleId: string) => void;
  onCancel: (saleId: string) => void;
  onRequestPayment: (order: SaleListItemView) => void;
}

export function QrOrderDetailPanel({ order, isLoading, menu, approveBusy, cancelBusy, onApprove, onCancel, onRequestPayment }: Props) {
  const nameById = new Map(menu.map((m) => [m.id, m.name]));

  if (!order) {
    return (
      <aside className="w-[400px] shrink-0 border-l bg-white flex flex-col h-full items-center justify-center text-center p-6">
        <QrCode className="w-12 h-12 text-muted-foreground/40 mb-3" />
        <div className="text-sm text-muted-foreground">Chọn đơn khách QR để xem chi tiết</div>
      </aside>
    );
  }

  const filter = getCustomerOrderQueueFilter(order);
  const subtotal = Number(order.subtotal ?? 0);
  const discount = Number(order.discount ?? 0);
  const tax = Number(order.taxAmount ?? 0);
  const total = Number(order.totalAmount ?? 0);
  const items = order.items || [];

  return (
    <aside className="w-[400px] shrink-0 border-l bg-white flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="text-xs text-muted-foreground">Đơn khách QR</div>
        <div className="text-lg font-bold">#{String(order.id).slice(-8)}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Bàn: <span className="text-foreground font-medium">{order.orderingTableName || order.orderingTableCode || '—'}</span>
        </div>
        {order.createdAt && (
          <div className="text-xs text-muted-foreground">
            {new Date(order.createdAt).toLocaleString('vi-VN')}
          </div>
        )}
        {order.note && <div className="mt-2 text-xs text-muted-foreground">Ghi chú: {order.note}</div>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải...</div>}
        {!isLoading && items.length === 0 && (
          <div className="text-sm text-muted-foreground">Không có món.</div>
        )}
        <ul className="space-y-3">
          {items.map((l, idx) => {
            const name = (l.productId && nameById.get(String(l.productId))) || `Sản phẩm ${idx + 1}`;
            const qty = Number(l.quantity ?? 0);
            const unit = Number(l.unitPrice ?? 0);
            const lineTotal = Number(l.lineTotal ?? qty * unit);
            return (
              <li key={idx} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{name}</div>
                  <div className="text-xs text-muted-foreground">{qty} × {formatVnd(unit)}</div>
                  {l.note && <div className="text-xs text-muted-foreground">{String(l.note)}</div>}
                </div>
                <div className="font-semibold whitespace-nowrap">{formatVnd(lineTotal)}</div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="p-4 border-t space-y-2">
        <Row label="Tạm tính" value={formatVnd(subtotal)} />
        {discount > 0 && <Row label="Giảm giá" value={`- ${formatVnd(discount)}`} />}
        {tax > 0 && <Row label="VAT" value={formatVnd(tax)} />}
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="font-bold">Tổng cộng</span>
          <span className="font-bold text-lg pos-accent-text">{formatVnd(total)}</span>
        </div>

        <div className="pt-3 grid grid-cols-2 gap-2">
          {filter === 'waiting' && (
            <>
              <Button
                variant="outline"
                className="h-11"
                disabled={cancelBusy}
                onClick={() => {
                  if (window.confirm('Từ chối đơn này?')) onCancel(String(order.id));
                }}
              >
                <XCircle className="w-4 h-4 mr-1" /> Từ chối
              </Button>
              <Button
                className="h-11 pos-accent-bg hover:opacity-90"
                disabled={approveBusy}
                onClick={() => onApprove(String(order.id))}
              >
                {approveBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                Duyệt đơn
              </Button>
            </>
          )}
          {filter === 'approved' && (
            <Button
              className="h-11 col-span-2 pos-accent-bg hover:opacity-90"
              onClick={() => onRequestPayment(order as SaleListItemView)}
            >
              <CreditCard className="w-4 h-4 mr-1" /> Thanh toán ({formatVnd(total)})
            </Button>
          )}
          {filter === 'paid' && (
            <div className="col-span-2 text-center text-sm text-success font-medium py-2">Đã thanh toán</div>
          )}
          {filter === 'cancelled' && (
            <div className="col-span-2 text-center text-sm text-destructive font-medium py-2">Đơn đã hủy</div>
          )}
        </div>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
