import { useState } from 'react';
import { Minus, Plus, ShoppingBag, Store, Trash2, User, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { AppliedVoucher, CartLine, OrderType } from '../hooks/use-pos-cart';
import { LOYALTY } from '../data/mock-menu';
import { formatVnd } from '../utils/format';

interface Props {
  orderNo: string;
  orderType: OrderType;
  onOrderTypeChange: (t: OrderType) => void;
  customerName: string;
  onCustomerNameChange: (v: string) => void;
  lines: CartLine[];
  lineTotal: (l: CartLine) => number;
  onQtyChange: (lineId: string, q: number) => void;
  onRemove: (lineId: string) => void;
  onClear: () => void;
  voucher: AppliedVoucher | null;
  voucherError: string;
  onApplyVoucher: (code: string) => void;
  loyaltyPhone: string;
  onLoyaltyPhoneChange: (v: string) => void;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  onCheckout: () => void;
  onSaveDraft: () => void;
}

export function CartPanel(p: Props) {
  const [voucherInput, setVoucherInput] = useState('');
  const loyalty = LOYALTY[p.loyaltyPhone.trim()];

  return (
    <aside className="w-[400px] shrink-0 border-l bg-white flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Đơn hàng</div>
          <div className="text-2xl font-bold">#{p.orderNo}</div>
        </div>
        {p.lines.length > 0 && (
          <button type="button" onClick={p.onClear} className="inline-flex items-center gap-1 text-sm text-destructive hover:opacity-80">
            <X className="w-4 h-4" /> Xóa
          </button>
        )}
      </div>

      <div className="p-4 space-y-3 border-b">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => p.onOrderTypeChange('takeaway')}
            className={`h-11 rounded-md border inline-flex items-center justify-center gap-2 text-sm font-medium transition ${
              p.orderType === 'takeaway'
                ? 'border-[hsl(var(--pos-accent))] pos-accent-soft-bg pos-accent-text'
                : 'hover:bg-accent'
            }`}
          >
            <ShoppingBag className="w-4 h-4" /> Mang đi
          </button>
          <button
            type="button"
            onClick={() => p.onOrderTypeChange('dinein')}
            className={`h-11 rounded-md border inline-flex items-center justify-center gap-2 text-sm font-medium transition ${
              p.orderType === 'dinein'
                ? 'border-[hsl(var(--pos-accent))] pos-accent-soft-bg pos-accent-text'
                : 'hover:bg-accent'
            }`}
          >
            <Store className="w-4 h-4" /> Tại quầy
          </button>
        </div>
        <Input
          value={p.customerName}
          onChange={(e) => p.onCustomerNameChange(e.target.value)}
          placeholder="Tên khách (tùy chọn)"
          className="h-10"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {p.lines.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground px-6 text-center">
            <ShoppingBag className="w-10 h-10 opacity-40" />
            <div className="text-sm">Chưa có món nào.<br />Chọn món từ menu bên trái.</div>
          </div>
        ) : (
          <div className="divide-y">
            {p.lines.map((l) => {
              const subtitle = [
                l.size && `Size ${l.size}`,
                l.sugar !== undefined && `Đường ${l.sugar}%`,
                l.ice !== undefined && `Đá ${l.ice}%`,
                ...l.toppings.map((t) => `+${t.name}`),
              ].filter(Boolean).join(' · ');
              return (
                <div key={l.lineId} className="p-4 flex gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
                    {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
                    {l.note && <div className="text-xs italic text-muted-foreground mt-0.5">Ghi chú: {l.note}</div>}
                    <div className="flex items-center justify-between mt-2">
                      <div className="inline-flex items-center gap-1 border rounded-md">
                        <button type="button" onClick={() => p.onQtyChange(l.lineId, l.quantity - 1)} className="h-7 w-7 inline-flex items-center justify-center hover:bg-accent">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-7 text-center text-sm font-medium">{l.quantity}</span>
                        <button type="button" onClick={() => p.onQtyChange(l.lineId, l.quantity + 1)} className="h-7 w-7 inline-flex items-center justify-center hover:bg-accent">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="pos-accent-text font-bold">{formatVnd(p.lineTotal(l))}</div>
                    </div>
                  </div>
                  <button type="button" onClick={() => p.onRemove(l.lineId)} className="h-7 w-7 rounded-md hover:bg-destructive/10 text-destructive inline-flex items-center justify-center shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t p-4 space-y-3">
        <div>
          <div className="flex gap-2">
            <Input
              value={voucherInput}
              onChange={(e) => setVoucherInput(e.target.value)}
              placeholder="Mã giảm giá"
              className="h-10"
            />
            <Button
              variant="outline"
              onClick={() => p.onApplyVoucher(voucherInput)}
              className="h-10 shrink-0"
            >
              Áp dụng
            </Button>
          </div>
          {p.voucher && <div className="text-xs text-emerald-600 mt-1">✓ {p.voucher.label}</div>}
          {p.voucherError && <div className="text-xs text-destructive mt-1">{p.voucherError}</div>}
        </div>

        <div className="relative">
          <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={p.loyaltyPhone}
            onChange={(e) => p.onLoyaltyPhoneChange(e.target.value)}
            placeholder="SĐT khách hàng thân thiết"
            className="pl-9 h-10"
          />
          {loyalty && (
            <div className="text-xs text-emerald-600 mt-1">
              ✓ {loyalty.name} · {loyalty.points} điểm
            </div>
          )}
        </div>

        <div className="space-y-1 text-sm pt-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Tạm tính</span><span>{formatVnd(p.subtotal)}</span></div>
          {p.discount > 0 && (
            <div className="flex justify-between text-emerald-600"><span>Giảm giá</span><span>-{formatVnd(p.discount)}</span></div>
          )}
          <div className="flex justify-between"><span className="text-muted-foreground">VAT (8%)</span><span>{formatVnd(p.vat)}</span></div>
        </div>
        <div className="flex justify-between items-baseline pt-2 border-t">
          <div className="font-semibold">Tổng cộng</div>
          <div className="pos-accent-text text-2xl font-bold">{formatVnd(p.total)}</div>
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-2 pt-1">
          <Button variant="outline" onClick={p.onSaveDraft} disabled={p.lines.length === 0} className="h-12">Lưu tạm</Button>
          <Button onClick={p.onCheckout} disabled={p.lines.length === 0} className="h-12 pos-accent-bg hover:opacity-90 text-base font-semibold">
            Thanh toán
          </Button>
        </div>
      </div>
    </aside>
  );
}
