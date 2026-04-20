import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock3, Loader2, RefreshCcw, ShoppingBag, Store, XCircle } from 'lucide-react';
import type { SaleListItemView } from '@/api/sales-api';
import { formatVnd, formatDateTime } from '../utils/format';
import type { OrderScope } from '../hooks/use-orders-feed';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: OrderScope;
  isLoading: boolean;
  error?: unknown;
  orders: SaleListItemView[];
  onRefresh: () => void;
  onResume?: (order: SaleListItemView) => void;
  onCancel?: (order: SaleListItemView) => void;
  hasSession?: boolean;
  cancellingId?: string | null;
}

function statusBadge(order: SaleListItemView) {
  const s = order.paymentStatus ?? order.status ?? '';
  if (s === 'paid') return { label: 'Đã thanh toán', cls: 'bg-emerald-100 text-emerald-700' };
  if (s === 'unpaid') return { label: 'Chưa thanh toán', cls: 'bg-amber-100 text-amber-700' };
  if (s === 'partially_paid') return { label: 'Thanh toán một phần', cls: 'bg-amber-100 text-amber-700' };
  if (s === 'order_created') return { label: 'Chưa duyệt', cls: 'bg-slate-100 text-slate-700' };
  if (s === 'order_approved') return { label: 'Đã duyệt', cls: 'bg-blue-100 text-blue-700' };
  if (s === 'cancelled') return { label: 'Đã hủy', cls: 'bg-rose-100 text-rose-700' };
  return { label: s || '—', cls: 'bg-slate-100 text-slate-700' };
}

function orderTypeLabel(t?: string | null) {
  if (t === 'takeaway') return { label: 'Mang đi', Icon: ShoppingBag };
  if (t === 'dine_in') return { label: 'Tại quầy', Icon: Store };
  if (t === 'delivery') return { label: 'Giao hàng', Icon: ShoppingBag };
  return { label: t ?? '—', Icon: ShoppingBag };
}

export function OrdersDrawer({ open, onOpenChange, scope, isLoading, error, orders, onRefresh, onResume, onCancel, hasSession = true, cancellingId = null }: Props) {
  const title = scope === 'pending' ? 'Đơn đang chờ' : 'Đơn hôm nay';
  const subtitle = scope === 'pending'
    ? 'Đơn của ca hiện tại — chưa thanh toán.'
    : 'Đơn đã thanh toán trong hôm nay (theo outlet hiện tại).';
  const pendingNoSession = scope === 'pending' && !hasSession;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto pos-order-root">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle>{title}</SheetTitle>
            <Button variant="ghost" size="sm" onClick={onRefresh}>
              <RefreshCcw className="w-4 h-4 mr-1" /> Làm mới
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {pendingNoSession && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Chưa mở ca — mở ca để xem đơn đang chờ.
            </div>
          )}
          {!pendingNoSession && isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
            </div>
          )}
          {!pendingNoSession && !isLoading && error && (
            <div className="py-8 text-sm text-destructive text-center">Không tải được danh sách.</div>
          )}
          {!pendingNoSession && !isLoading && !error && orders.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {scope === 'pending' ? 'Không có đơn đang chờ trong ca này.' : 'Chưa có đơn nào hôm nay.'}
            </div>
          )}
          {!pendingNoSession && !isLoading && !error && orders.map((order) => {
            const { label, cls } = statusBadge(order);
            const typeInfo = orderTypeLabel(order.orderType);
            const TypeIcon = typeInfo.Icon;
            const items = order.items ?? [];
            const total = order.totalAmount ?? 0;
            return (
              <div key={order.id} className="border rounded-lg bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">#{String(order.id).slice(-6)}</div>
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Clock3 className="w-3 h-3" /> {order.createdAt ? formatDateTime(order.createdAt) : '—'}
                    </div>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TypeIcon className="w-3.5 h-3.5" /> {typeInfo.label}
                  {order.note && <span className="truncate">· {order.note}</span>}
                </div>
                {items.length > 0 && (
                  <ul className="text-xs space-y-0.5">
                    {items.slice(0, 4).map((li, idx) => (
                      <li key={idx} className="flex justify-between gap-2">
                        <span className="truncate">
                          × {Number(li.quantity ?? 0)} · {(li as { productName?: string }).productName ?? li.productId}
                        </span>
                        <span className="text-muted-foreground">{formatVnd(Number(li.lineTotal ?? 0))}</span>
                      </li>
                    ))}
                    {items.length > 4 && <li className="text-muted-foreground">... và {items.length - 4} món khác</li>}
                  </ul>
                )}
                <div className="flex items-center justify-between pt-1 border-t">
                  <span className="text-xs text-muted-foreground">Tổng</span>
                  <span className="pos-accent-text font-bold">{formatVnd(Number(total))}</span>
                </div>
                {scope === 'pending' && (onResume || onCancel) && (
                  <div className="flex gap-2">
                    {onResume && (
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => onResume(order)}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Tiếp tục thanh toán
                      </Button>
                    )}
                    {onCancel && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
                        disabled={cancellingId === String(order.id)}
                        onClick={() => {
                          if (window.confirm(`Hủy đơn #${String(order.id).slice(-6)}?`)) onCancel(order);
                        }}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Hủy đơn
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
