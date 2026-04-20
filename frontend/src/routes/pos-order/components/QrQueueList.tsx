import { Clock, QrCode, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { SaleListItemView } from '@/api/sales-api';
import { getCustomerOrderQueueFilter } from '@/components/pos/customer-order-queue';
import { formatVnd } from '../utils/format';

interface Props {
  orders: SaleListItemView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  isLoading: boolean;
  error?: unknown;
}

function statusLabel(order: SaleListItemView) {
  switch (getCustomerOrderQueueFilter(order)) {
    case 'paid': return { text: 'Đã thanh toán', cls: 'bg-success/10 text-success' };
    case 'approved': return { text: 'Đã duyệt', cls: 'bg-info/10 text-info' };
    case 'cancelled': return { text: 'Đã hủy', cls: 'bg-destructive/10 text-destructive' };
    default: return { text: 'Chờ duyệt', cls: 'bg-warning/10 text-warning' };
  }
}

function shortId(id: string) {
  const s = String(id || '');
  return s.length <= 8 ? s : s.slice(-8);
}

function timeAgo(iso?: string | null) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return new Date(iso).toLocaleString('vi-VN');
}

export function QrQueueList({ orders, selectedId, onSelect, search, onSearchChange, isLoading, error }: Props) {
  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[hsl(var(--pos-bg))]">
      <div className="p-4 border-b bg-white">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm theo mã đơn, bàn, ghi chú..."
            className="pl-9"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="text-sm text-destructive">Không tải được đơn — {error instanceof Error ? error.message : 'lỗi không xác định'}</div>
        )}
        {isLoading && !orders.length && (
          <div className="text-sm text-muted-foreground">Đang tải...</div>
        )}
        {!isLoading && !orders.length && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <QrCode className="w-12 h-12 mb-3 opacity-40" />
            <div className="text-sm">Không có đơn khách QR nào.</div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {orders.map((o) => {
            const s = statusLabel(o);
            const active = selectedId === String(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onSelect(String(o.id))}
                className={`text-left rounded-xl border bg-white p-3 transition shadow-sm hover:shadow ${
                  active ? 'border-[hsl(var(--pos-accent))] ring-1 ring-[hsl(var(--pos-accent))]' : 'hover:border-[hsl(var(--pos-accent-soft))]'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="text-xs text-muted-foreground">#{shortId(String(o.id))}</div>
                    <div className="font-semibold">{o.orderingTableName || o.orderingTableCode || 'Không có bàn'}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${s.cls}`}>{s.text}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                  <Clock className="w-3 h-3" /> {timeAgo(o.createdAt)}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{(o.items?.length ?? 0)} món</span>
                  <span className="font-bold pos-accent-text">{formatVnd(Number(o.totalAmount ?? 0))}</span>
                </div>
                {o.note && <div className="mt-2 text-xs text-muted-foreground line-clamp-2">Ghi chú: {o.note}</div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
