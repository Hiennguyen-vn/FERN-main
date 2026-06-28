import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  DollarSign,
  Loader2,
  LogOut,
  Power,
  ShoppingBag,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PosSessionView } from '@/api/sales-api';
import { cn } from '@/lib/utils';
import { formatDateTime, formatVnd } from '../utils/format';
import type { ShiftCloseSummary } from '../hooks/use-shift-close-summary';
import { buildReconcileLines, resolveExpectedCashInDrawer } from '../utils/shift-close';

type Phase = 'review' | 'confirm' | 'success';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outletName: string;
  session: PosSessionView;
  openingCash: number;
  summary: ShiftCloseSummary | null;
  summaryLoading: boolean;
  pendingCount: number;
  currencyCode: string;
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (args: {
    lines: Array<{ paymentMethod: string; actualAmount: number }>;
    note?: string;
  }) => Promise<unknown>;
  onLogout: () => void;
}

export function CloseShiftDialog({
  open,
  onOpenChange,
  outletName,
  session,
  openingCash,
  summary,
  summaryLoading,
  pendingCount,
  isSubmitting,
  error,
  onSubmit,
  onLogout,
}: Props) {
  const [phase, setPhase] = useState<Phase>('review');
  const [cashCounted, setCashCounted] = useState('');
  const [note, setNote] = useState('');

  const cashSalesTotal = summary?.paymentBreakdown.find((row) => row.method === 'cash')?.total ?? 0;
  const expectedCash = useMemo(
    () => resolveExpectedCashInDrawer(summary?.cash, openingCash, cashSalesTotal),
    [summary?.cash, openingCash, cashSalesTotal],
  );

  const cashValue = Number(cashCounted);
  const cashValid = Number.isFinite(cashValue) && cashValue >= 0;
  const cashVariance = cashValid ? cashValue - expectedCash : 0;
  const hasCashVariance = cashValid && Math.abs(cashVariance) >= 1;

  useEffect(() => {
    if (!open) return;
    setPhase('review');
    setNote('');
    setCashCounted(String(Math.round(expectedCash)));
  }, [open, expectedCash, session.id]);

  useEffect(() => {
    if (error && phase === 'confirm') {
      setPhase('review');
    }
  }, [error, phase]);

  const handleSubmit = async () => {
    if (!cashValid) return;
    try {
      await onSubmit({
        lines: buildReconcileLines(summary?.paymentBreakdown ?? [], cashValue),
        note: note.trim() || undefined,
      });
      setPhase('success');
    } catch {
      // Parent surfaces error via `error` prop.
    }
  };

  const handleClose = (next: boolean) => {
    if (phase === 'success') {
      onOpenChange(false);
      return;
    }
    if (!isSubmitting) onOpenChange(next);
  };

  const orderCount = summary?.orderCount ?? Number(session.orderCount ?? 0);
  const totalRevenue = summary?.totalRevenue ?? Number(session.totalRevenue ?? 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-md max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => {
          if (phase !== 'success') e.preventDefault();
        }}
      >
        {phase === 'success' ? (
          <div className="py-4 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full pos-success-bg">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Đã đóng ca thành công</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Ca <span className="font-medium text-foreground">{session.sessionCode}</span> đã được đối soát và đóng.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button className="h-11 pos-accent-bg hover:opacity-90 gap-2" onClick={onLogout}>
                <LogOut className="h-4 w-4" />
                Đăng xuất
              </Button>
              <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>
                Ở lại — mở ca mới
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Power className="w-5 h-5 pos-accent-text" />
                Đóng ca bán hàng
              </DialogTitle>
            </DialogHeader>

            <div className="text-sm text-muted-foreground">
              Outlet: <span className="font-medium text-foreground">{outletName}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono font-medium text-foreground">{session.sessionCode}</span>
              {session.openedAt && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Mở lúc {formatDateTime(session.openedAt)}
                </span>
              )}
            </div>

            {pendingCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  Còn <strong>{pendingCount}</strong> đơn chưa thanh toán — vui lòng xử lý trước khi đóng ca.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <ShoppingBag className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
                <p className="text-xl font-semibold text-foreground">
                  {summaryLoading ? '…' : orderCount}
                </p>
                <p className="text-[10px] text-muted-foreground">Đơn đã thanh toán</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <DollarSign className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
                <p className="text-xl font-semibold text-foreground">
                  {summaryLoading ? '…' : formatVnd(totalRevenue)}
                </p>
                <p className="text-[10px] text-muted-foreground">Doanh thu ca</p>
              </div>
            </div>

            {summary && summary.paymentBreakdown.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Phân bổ thanh toán</p>
                {summary.paymentBreakdown.map((row) => (
                  <div key={row.method} className="flex items-center justify-between rounded-md bg-muted/30 px-2.5 py-2">
                    <span className="text-xs text-foreground">{row.label}</span>
                    <span className="text-xs font-medium text-foreground">
                      {formatVnd(row.total)} ({row.count})
                    </span>
                  </div>
                ))}
              </div>
            )}

            {phase === 'review' ? (
              <div className="space-y-3 pt-1">
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Tiền đầu ca</span>
                    <span className="font-medium text-foreground">{formatVnd(openingCash)}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>Tiền mặt dự kiến trong két</span>
                    <span className="font-medium text-foreground">{formatVnd(expectedCash)}</span>
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                    <Banknote className="h-3.5 w-3.5 pos-accent-text" />
                    Tiền mặt thực tế đếm được
                  </div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={cashCounted}
                    onChange={(e) => setCashCounted(e.target.value)}
                    className="h-10 text-right text-base font-semibold"
                  />
                  {cashValid && hasCashVariance && (
                    <p className={cn(
                      'mt-1 text-xs font-medium',
                      cashVariance > 0 ? 'text-success' : 'text-destructive',
                    )}>
                      Chênh lệch: {cashVariance > 0 ? '+' : ''}{formatVnd(cashVariance)}
                    </p>
                  )}
                </div>

                <div>
                  <div className="text-xs font-medium mb-1">Ghi chú (tùy chọn)</div>
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Lý do chênh lệch hoặc ghi chú đóng ca"
                    className="h-10"
                  />
                </div>

                {error && <div className="text-sm text-destructive">{error}</div>}

                <Button
                  className="w-full h-11 pos-accent-bg hover:opacity-90"
                  disabled={!cashValid || pendingCount > 0 || isSubmitting}
                  onClick={() => setPhase('confirm')}
                >
                  Tiếp tục đối soát
                </Button>
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                <div className="rounded-lg border border-warning/20 bg-warning/8 px-3 py-3 text-center">
                  <p className="text-sm font-medium text-foreground">Xác nhận đóng ca?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sau khi đóng, không thể tạo đơn mới trong ca này. Tiền mặt đếm: <strong>{formatVnd(cashValue)}</strong>
                  </p>
                </div>

                {error && <div className="text-sm text-destructive">{error}</div>}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 h-10"
                    disabled={isSubmitting}
                    onClick={() => setPhase('review')}
                  >
                    Quay lại
                  </Button>
                  <Button
                    className="flex-1 h-10 pos-accent-bg hover:opacity-90"
                    disabled={isSubmitting || pendingCount > 0}
                    onClick={() => void handleSubmit()}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Xác nhận đóng ca'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
