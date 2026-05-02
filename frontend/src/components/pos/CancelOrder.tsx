import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, AlertTriangle, Loader2, ShieldAlert, XCircle, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { salesApi, type VoidReason } from '@/api/sales-api';
import type { SaleOrder } from '@/types/pos';
import { formatPosCurrency } from '@/components/pos/sale-order-utils';

export interface CancelOrderConfirm {
  reasonCode: string;
  reason: string;
  voidNote?: string;
  managerPin?: string;
  managerUserId?: number;
}

interface Props {
  order: SaleOrder;
  onBack: () => void;
  onConfirm: (payload: CancelOrderConfirm) => void;
}

const CATEGORY_LABEL: Record<VoidReason['category'], string> = {
  CUSTOMER: 'Khách hàng',
  OPERATIONAL: 'Vận hành',
  COMPLIANCE: 'Tuân thủ',
  FINANCIAL: 'Tài chính',
};

export function CancelOrder({ order, onBack, onConfirm }: Props) {
  const { token } = useShellRuntime();
  const [reasons, setReasons] = useState<VoidReason[]>([]);
  const [loadingReasons, setLoadingReasons] = useState(true);
  const [reasonCode, setReasonCode] = useState('');
  const [voidNote, setVoidNote] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoadingReasons(true);
    salesApi
      .listVoidReasons(token)
      .then((rows) => {
        if (active) setReasons(rows);
      })
      .catch(() => {
        if (active) setReasons([]);
      })
      .finally(() => {
        if (active) setLoadingReasons(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const groupedReasons = useMemo(() => {
    const buckets: Record<string, VoidReason[]> = {};
    for (const r of reasons) {
      buckets[r.category] = buckets[r.category] ?? [];
      buckets[r.category].push(r);
    }
    return buckets;
  }, [reasons]);

  const selectedReason = reasons.find((r) => r.code === reasonCode);
  const requiresManagerApproval = selectedReason?.requiresManagerApproval ?? false;

  const canSubmit = !!reasonCode && (!requiresManagerApproval || managerPin.trim().length >= 4);

  const handleConfirm = () => {
    if (!selectedReason) return;
    setSubmitting(true);
    try {
      onConfirm({
        reasonCode: selectedReason.code,
        reason: selectedReason.label,
        voidNote: voidNote.trim() || undefined,
        managerPin: requiresManagerApproval ? managerPin.trim() : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (order.status !== 'open') {
    return (
      <div className="p-6 animate-fade-in">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        <div className="max-w-md mx-auto surface-elevated p-6 text-center">
          <XCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Cannot cancel this order</p>
          <p className="text-xs text-muted-foreground mt-1">
            Only open orders can be cancelled. Completed orders are immutable in V1.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      <div className="max-w-lg mx-auto surface-elevated p-6 space-y-5">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-3">
            <XCircle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            Hủy đơn {order.orderNumber}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Chọn lý do hủy theo danh mục F&amp;B chuẩn
          </p>
        </div>

        <div className="p-3 rounded-lg bg-muted/40 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Số món</span>
            <span className="text-foreground">{order.lineItems.length}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Tổng</span>
            <span className="text-foreground font-medium">{formatPosCurrency(order.total, order.currencyCode)}</span>
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">
            Lý do hủy <span className="text-destructive">*</span>
          </Label>
          {loadingReasons ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải danh mục...
            </div>
          ) : reasons.length === 0 ? (
            <div className="text-xs text-warning">Không tải được danh mục lý do.</div>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {Object.entries(groupedReasons).map(([cat, items]) => (
                <div key={cat} className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_LABEL[cat as VoidReason['category']] ?? cat}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {items.map((reason) => {
                      const active = reasonCode === reason.code;
                      return (
                        <button
                          key={reason.code}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setReasonCode(reason.code)}
                          className={cn(
                            'text-left px-3 py-2 rounded-md border transition-colors text-xs flex flex-col gap-0.5',
                            active
                              ? 'border-destructive bg-destructive/10 text-foreground'
                              : 'border-border hover:bg-muted',
                          )}
                        >
                          <span className="font-medium flex items-center gap-1">
                            {active && <Check className="h-3 w-3 text-destructive flex-shrink-0" aria-hidden="true" />}
                            {reason.label}
                            {reason.requiresManagerApproval && (
                              <ShieldAlert className="h-3 w-3 text-warning" />
                            )}
                          </span>
                          {reason.description && (
                            <span className="text-muted-foreground text-[11px]">
                              {reason.description}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="voidNote" className="text-sm font-medium text-foreground">
            Ghi chú thêm (tùy chọn)
          </Label>
          <Textarea
            id="voidNote"
            value={voidNote}
            onChange={(e) => setVoidNote(e.target.value)}
            placeholder="VD: bàn 5 đặt nhầm, manager Linh đã duyệt"
            className="min-h-[64px] text-sm"
          />
        </div>

        {requiresManagerApproval && (
          <div className="space-y-2 p-3 rounded-lg bg-warning/10 border border-warning/30" role="region" aria-labelledby="manager-pin-heading">
            <div id="manager-pin-heading" className="flex items-center gap-2 text-xs text-warning font-medium">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Yêu cầu manager duyệt
            </div>
            <Label htmlFor="managerPin" className="text-xs text-foreground">
              PIN manager <span className="text-destructive" aria-hidden="true">*</span>
              <span className="sr-only">(bắt buộc)</span>
            </Label>
            <Input
              id="managerPin"
              type="password"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              minLength={4}
              required
              aria-required="true"
              aria-invalid={managerPin.length > 0 && managerPin.length < 4}
              aria-describedby="manager-pin-help"
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Nhập PIN 4-6 số"
              className="h-9 font-mono tracking-widest"
            />
            <p id="manager-pin-help" className="text-[10px] text-muted-foreground" aria-live="polite">
              {managerPin.length === 0
                ? 'Manager PIN 4-6 chữ số. Audit log lưu mã user duyệt.'
                : managerPin.length < 4
                ? `Còn thiếu ${4 - managerPin.length} chữ số`
                : `${managerPin.length} chữ số ✓`}
            </p>
          </div>
        )}

        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-warning/8 border border-warning/15">
          <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Hủy order là hành động không thể đảo ngược. Audit log lưu lý do, người hủy và
            người duyệt.
          </p>
        </div>

        {!confirming ? (
          <Button
            variant="destructive"
            className="w-full h-9 text-xs"
            disabled={!canSubmit}
            onClick={() => setConfirming(true)}
          >
            Hủy order
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="p-2.5 rounded-md bg-destructive/8 border border-destructive/15 text-center">
              <p className="text-xs font-medium text-foreground">
                Xác nhận hủy với lý do "{selectedReason?.label}"?
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs"
                onClick={() => setConfirming(false)}
              >
                Quay lại
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="flex-1 h-8 text-xs"
                disabled={submitting}
                onClick={handleConfirm}
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Xác nhận hủy'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
